import os
from datetime import date
from flask import Blueprint, request, jsonify, send_from_directory, Response
from sqlalchemy.exc import IntegrityError
from models import db, Exam, Course, Slot, Booking, Evaluation, Rubric
from common import *
from utils import guard, current_user
from cache import cached, invalidate

bp = Blueprint("student", __name__, url_prefix="/api/student")
EXPORT_DIR = os.path.join(os.path.abspath(os.path.dirname(__file__)), "exports")


@bp.before_request
def _guard():
    return guard("student")


def active_booking_map(uid):
    return {b.exam_id: b for b in Booking.query.filter(Booking.student_id == uid, Booking.status != "Cancelled")}


@bp.get("/exams")
def exams():
    u = current_user()
    allx = cached("exams:public", lambda: [exam_dict(e) for e in
                  Exam.query.filter(Exam.status != "Draft").order_by(Exam.id.desc())], ttl=120)
    q, typ, cid, st = (request.args.get(k) for k in ("q", "exam_type", "course_id", "status"))
    mine = active_booking_map(u.id); out = []
    for e in allx:
        if q and q.lower() not in (e["name"] + e["course_name"] + e["course_code"]).lower(): continue
        if typ and e["exam_type"] != typ: continue
        if cid and e["course_id"] != int(cid): continue
        if st and e["status"] != st: continue
        e = dict(e); b = mine.get(e["id"])
        # re-evaluate window flag (cache may be stale w.r.t. clock)
        e["booking_open"] = e["status"] == "Booking Open" and _in_window(e)
        e["my_booking"] = {"id": b.id, "status": b.status, "slot": slot_dict(b.slot)} if b else None
        out.append(e)
    return jsonify(out)


def _in_window(e):
    from datetime import datetime
    now = datetime.now()
    s = datetime.fromisoformat(e["booking_start"]) if e["booking_start"] else None
    t = datetime.fromisoformat(e["booking_end"]) if e["booking_end"] else None
    return not (s and now < s) and not (t and now > t)


@bp.get("/exams/<int:eid>/slots")
def exam_slots(eid):
    exam = db.get_or_404(Exam, eid)
    if exam.status == "Draft": return bad("Examination not available", 404)
    data = cached(f"schedule:{eid}", lambda: [slot_dict(s) for s in
                  Slot.query.filter(Slot.exam_id == eid, Slot.status != "Cancelled").order_by(Slot.date, Slot.start_time)], ttl=60)
    return jsonify(dict(exam=exam_dict(exam), slots=data, rubrics=get_rubrics(eid)))


@bp.post("/slots/<int:sid>/book")
def book(sid):
    u = current_user(); slot = db.get_or_404(Slot, sid); exam = slot.exam
    if not booking_open(exam): return bad("Booking is not open for this examination", 409)
    if slot.status in ("Cancelled", "Completed"): return bad("Slot is not available", 409)
    if Booking.query.filter(Booking.student_id == u.id, Booking.exam_id == exam.id, Booking.status != "Cancelled").first():
        return bad("You already have a booking for this examination", 409)
    # atomic seat decrement prevents overbooking
    got = Slot.query.filter(Slot.id == sid, Slot.available_seats > 0, Slot.status == "Available") \
        .update({Slot.available_seats: Slot.available_seats - 1}, synchronize_session=False)
    if not got:
        db.session.rollback(); return bad("Slot is full", 409)
    Slot.query.filter(Slot.id == sid, Slot.available_seats == 0).update({Slot.status: "Full"}, synchronize_session=False)
    b = Booking(student_id=u.id, slot_id=sid, exam_id=exam.id, status="Booked")
    db.session.add(b)
    notify(u.id, f"Booked {exam.name} on {slot.date} at {slot.start_time:%H:%M}")
    try: db.session.commit()
    except IntegrityError:
        db.session.rollback(); return bad("Duplicate booking prevented", 409)
    invalidate("schedule")
    return jsonify(id=b.id, message="Slot booked"), 201


@bp.post("/bookings/<int:bid>/cancel")
def cancel(bid):
    u = current_user(); b = db.get_or_404(Booking, bid)
    if b.student_id != u.id: return bad("Not your booking", 403)
    if b.status != "Booked": return bad("Only active bookings can be cancelled", 409)
    if not booking_open(b.exam): return bad("Cancellation deadline has passed", 409)
    b.status = "Cancelled"
    Slot.query.filter(Slot.id == b.slot_id).update({Slot.available_seats: Slot.available_seats + 1}, synchronize_session=False)
    Slot.query.filter(Slot.id == b.slot_id, Slot.status == "Full").update({Slot.status: "Available"}, synchronize_session=False)
    notify(u.id, f"Cancelled booking for {b.exam.name}")
    db.session.commit(); invalidate("schedule")
    return jsonify(message="Booking cancelled")


@bp.get("/bookings")
def my_bookings():
    qs = Booking.query.filter_by(student_id=current_user().id).order_by(Booking.id.desc())
    out = []
    for b in qs:
        d = booking_dict(b)
        d["marks"] = b.evaluation.total_marks if (b.evaluation and b.exam.results_published) else None
        d["max_marks"] = b.exam.max_marks
        out.append(d)
    return jsonify(out)


@bp.get("/results")
def results():
    out = []
    for b in Booking.query.join(Evaluation).join(Exam, Booking.exam_id == Exam.id) \
            .filter(Booking.student_id == current_user().id, Exam.results_published == True).order_by(Booking.id.desc()):
        out.append(dict(booking=booking_dict(b), evaluation=evaluation_dict(b.evaluation), rubrics=get_rubrics(b.exam_id)))
    return jsonify(out)


@bp.get("/dashboard")
def dashboard():
    u = current_user(); today = date.today()
    mine = Booking.query.filter(Booking.student_id == u.id, Booking.status != "Cancelled").all()
    open_exams = [exam_dict(e) for e in Exam.query.filter_by(status="Booking Open") if booking_open(e)]
    open_ids = {e["id"] for e in open_exams}
    taken = {b.exam_id for b in mine}
    return jsonify(
        available_exams=[e for e in open_exams if e["id"] not in taken],
        available_slots=Slot.query.filter(Slot.exam_id.in_(open_ids or [0]), Slot.available_seats > 0, Slot.status == "Available").count(),
        upcoming=[booking_dict(b) for b in mine if b.status == "Booked" and b.slot.date >= today],
        booked=[booking_dict(b) for b in mine if b.status == "Booked"],
        results=sum(1 for b in mine if b.evaluation and b.exam.results_published))


@bp.get("/bookings/<int:bid>/scorecard")
def scorecard(bid):
    u = current_user(); b = db.get_or_404(Booking, bid)
    if b.student_id != u.id or not b.evaluation or not b.exam.results_published: return bad("Scorecard not available", 404)
    ev, ex = b.evaluation, b.exam
    names = {r["id"]: r for r in get_rubrics(ex.id)}
    rows = "".join(f"<tr><td>{names[s.rubric_id]['criterion']}</td><td>{s.marks:g} / {names[s.rubric_id]['max_marks']:g}</td></tr>"
                   for s in ev.scores if s.rubric_id in names)
    html = f"""<html><head><title>Scorecard</title><style>body{{font-family:sans-serif;max-width:640px;margin:30px auto}}
    td,th{{border:1px solid #999;padding:6px 10px}}table{{border-collapse:collapse;width:100%}}</style></head><body>
    <h2>Examination Scorecard</h2><p><b>{u.name}</b> ({u.email})</p><p>{ex.course.code} - {ex.course.name}<br>{ex.name} ({ex.exam_type})</p>
    <table><tr><th>Criterion</th><th>Marks</th></tr>{rows}<tr><th>Total</th><th>{ev.total_marks:g} / {ex.max_marks:g}</th></tr></table>
    <p><b>Examiner:</b> {b.slot.examiner.name}<br><b>Remarks:</b> {ev.remarks or '-'}</p>
    <p><button onclick="window.print()">Print / Save as PDF</button></p></body></html>"""
    return Response(html, mimetype="text/html")


# -------- async CSV export (Celery) --------
@bp.post("/export")
def export_start():
    try:
        from tasks import export_history
        r = export_history.apply_async(args=[current_user().id], retry=False)
        return jsonify(task_id=r.id, message="Export started; you will be alerted when it is ready"), 202
    except Exception:
        return bad("Background worker unavailable. Start Redis and the Celery worker.", 503)


@bp.get("/export/<task_id>")
def export_status(task_id):
    try:
        from celery.result import AsyncResult
        from celery_app import celery
        r = AsyncResult(task_id, app=celery)
        return jsonify(state=r.state, file=r.result if r.state == "SUCCESS" else None)
    except Exception:
        return jsonify(state="UNKNOWN", file=None)


@bp.get("/export/file/<name>")
def export_file(name):
    if not name.startswith(f"history_{current_user().id}_") or "/" in name or ".." in name: return bad("Not found", 404)
    return send_from_directory(EXPORT_DIR, name, as_attachment=True)
