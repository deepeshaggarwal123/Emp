import csv, os
from datetime import date, datetime, timedelta
from sqlalchemy import func
from celery_app import celery
from models import db, User, Exam, Slot, Booking, Evaluation
from common import notify
from mailer import send_email, send_gchat

BASE = os.path.abspath(os.path.dirname(__file__))
EXPORT_DIR = os.path.join(BASE, "exports")
REPORT_DIR = os.path.join(BASE, "reports")


# ---------- (a) scheduled: daily reminders ----------
@celery.task(name="tasks.daily_reminder")
def daily_reminder(days_ahead=1):
    today = date.today()
    rows = (Booking.query.join(Slot, Booking.slot_id == Slot.id)
            .filter(Booking.status == "Booked", Slot.date >= today, Slot.date <= today + timedelta(days=days_ahead)).all())
    chat_lines = []
    for b in rows:
        s, e = b.slot, b.exam
        html = (f"<h3>Examination reminder</h3><p>Hi {b.student.name},</p><ul><li><b>Examination:</b> {e.name} ({e.course.code})</li>"
                f"<li><b>Date &amp; time:</b> {s.date} {s.start_time:%H:%M}-{s.end_time:%H:%M}</li>"
                f"<li><b>Examiner:</b> {s.examiner.name}</li><li><b>Meeting link:</b> {s.meeting_link or 'N/A'}</li>"
                f"<li><b>Instructions:</b> {e.instructions or 'None'}</li></ul>")
        send_email(b.student.email, f"Reminder: {e.name} on {s.date}", html)
        notify(b.student_id, f"Reminder: {e.name} on {s.date} at {s.start_time:%H:%M} with {s.examiner.name}")
        chat_lines.append(f"{b.student.name}: {e.name}, {s.date} {s.start_time:%H:%M}, examiner {s.examiner.name}")
    db.session.commit()
    if chat_lines:
        send_gchat("Upcoming examinations:\n" + "\n".join(chat_lines))
    return len(rows)


# ---------- (b) scheduled: monthly admin report ----------
def build_report(year, month):
    start = date(year, month, 1)
    end = date(year + (month == 12), (month % 12) + 1, 1)
    in_month = (Slot.date >= start, Slot.date < end)
    completed = (Booking.query.join(Slot, Booking.slot_id == Slot.id).filter(Booking.status == "Completed", *in_month).count())
    exams_done = (db.session.query(func.count(func.distinct(Booking.exam_id))).join(Slot, Booking.slot_id == Slot.id)
                  .filter(Booking.status == "Completed", *in_month).scalar())
    evaluated = (db.session.query(func.count(func.distinct(Evaluation.student_id)))
                 .filter(Evaluation.evaluated_at >= start, Evaluation.evaluated_at < end).scalar())
    pending = (Booking.query.join(Slot, Booking.slot_id == Slot.id)
               .filter(Booking.status == "Booked", Slot.date < date.today()).count())
    top = (db.session.query(User.name, func.count(Evaluation.id)).join(Evaluation, Evaluation.examiner_id == User.id)
           .filter(Evaluation.evaluated_at >= start, Evaluation.evaluated_at < end)
           .group_by(User.id).order_by(func.count(Evaluation.id).desc()).limit(5).all())
    rows = "".join(f"<tr><td>{n}</td><td>{c}</td></tr>" for n, c in top) or "<tr><td colspan=2>No evaluations</td></tr>"
    html = f"""<html><body style="font-family:sans-serif"><h2>Monthly Examination Report - {start:%B %Y}</h2>
    <table border=1 cellpadding=6 style="border-collapse:collapse">
    <tr><td>Examinations conducted</td><td>{exams_done}</td></tr><tr><td>Students evaluated</td><td>{evaluated}</td></tr>
    <tr><td>Completed bookings</td><td>{completed}</td></tr><tr><td>Pending evaluations</td><td>{pending}</td></tr></table>
    <h3>Most active examiners</h3><table border=1 cellpadding=6 style="border-collapse:collapse">
    <tr><th>Examiner</th><th>Evaluations</th></tr>{rows}</table></body></html>"""
    return html, start


@celery.task(name="tasks.monthly_report")
def monthly_report(year=None, month=None):
    if not year:  # default: previous month
        first = date.today().replace(day=1); prev = first - timedelta(days=1); year, month = prev.year, prev.month
    html, start = build_report(year, month)
    os.makedirs(REPORT_DIR, exist_ok=True)
    with open(os.path.join(REPORT_DIR, f"report_{start:%Y_%m}.html"), "w", encoding="utf-8") as f:
        f.write(html)
    admin = User.query.filter_by(role="admin").first()
    return send_email(admin.email, f"Monthly Examination Report - {start:%B %Y}", html)


# ---------- (c) user-triggered: CSV export ----------
@celery.task(name="tasks.export_history")
def export_history(user_id):
    u = db.session.get(User, user_id)
    os.makedirs(EXPORT_DIR, exist_ok=True)
    name = f"history_{user_id}_{datetime.now():%Y%m%d%H%M%S}.csv"
    with open(os.path.join(EXPORT_DIR, name), "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["Student ID", "Examination Name", "Course", "Examination Date", "Examiner", "Marks Obtained", "Booking Status"])
        for b in Booking.query.filter_by(student_id=user_id).order_by(Booking.id):
            marks = b.evaluation.total_marks if (b.evaluation and b.exam.results_published) else ""
            w.writerow([user_id, b.exam.name, b.exam.course.name, b.slot.date, b.slot.examiner.name, marks, b.status])
    notify(user_id, f"Your examination history export is ready ({name})")
    db.session.commit()
    return name


@celery.task(name="tasks.notify_results")
def notify_results(exam_id):
    e = db.session.get(Exam, exam_id); n = 0
    for ev in Evaluation.query.join(Booking).filter(Booking.exam_id == exam_id):
        s = db.session.get(User, ev.student_id)
        send_email(s.email, f"Results published: {e.name}",
                   f"<p>Hi {s.name}, your result for <b>{e.name}</b> is {ev.total_marks}/{e.max_marks}. Log in to view remarks.</p>")
        n += 1
    return n
