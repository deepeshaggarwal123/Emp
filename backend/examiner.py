from datetime import date
from flask import Blueprint, request, jsonify
from sqlalchemy import and_
from models import db, User, Exam, Slot, Booking, Evaluation, EvaluationScore, Rubric
from common import *
from utils import guard, current_user
from cache import invalidate

bp = Blueprint("examiner", __name__, url_prefix="/api/examiner")


@bp.before_request
def _guard():
    return guard("examiner")


def body():
    return request.get_json(silent=True) or {}


def my_bookings(uid):
    return Booking.query.join(Slot, Booking.slot_id == Slot.id).filter(Slot.examiner_id == uid, Booking.status != "Cancelled")


@bp.get("/dashboard")
def dashboard():
    u = current_user()
    exams = Exam.query.filter(Exam.examiners.any(User.id == u.id)).order_by(Exam.id.desc()).all()
    mine = my_bookings(u.id)
    return jsonify(exams=[exam_dict(e) for e in exams],
                   slot_count=Slot.query.filter_by(examiner_id=u.id).count(),
                   booked_students=mine.count(),
                   pending_evaluations=mine.filter(Booking.status == "Booked").count())


@bp.get("/slots")
def slots():
    u = current_user(); qs = Slot.query.filter_by(examiner_id=u.id)
    if request.args.get("exam_id"): qs = qs.filter_by(exam_id=int(request.args["exam_id"]))
    return jsonify([slot_dict(s) for s in qs.order_by(Slot.date, Slot.start_time)])


def _apply_slot(s, d, exam, u):
    s.date, s.start_time, s.end_time = parse_date(d.get("date")), parse_time(d.get("start_time")), parse_time(d.get("end_time"))
    if s.end_time <= s.start_time: return bad("End time must be after start time")
    if s.date < date.today(): return bad("Slot date cannot be in the past")
    try: cap = int(d.get("capacity") or 1)
    except ValueError: return bad("Capacity must be a number")
    if cap < 1: return bad("Capacity must be at least 1")
    clash = Slot.query.filter(Slot.examiner_id == u.id, Slot.date == s.date, Slot.status != "Cancelled",
                              Slot.id != (s.id or 0), Slot.start_time < s.end_time, Slot.end_time > s.start_time).first()
    if clash: return bad("You already have a slot overlapping this time", 409)
    s.capacity, s.available_seats, s.meeting_link = cap, cap, d.get("meeting_link") or None


@bp.post("/slots")
def slot_create():
    u, d = current_user(), body()
    exam = db.session.get(Exam, d.get("exam_id") or 0)
    if not exam or u not in exam.examiners: return bad("Examination not assigned to you", 403)
    if not slot_creation_open(exam): return bad("Slot creation is not open for this examination (closed or outside its period)", 409)
    s = Slot(exam_id=exam.id, examiner_id=u.id, status="Available"); err = _apply_slot(s, d, exam, u)
    if err: return err
    db.session.add(s); db.session.commit(); invalidate("schedule")
    return jsonify(id=s.id), 201


def _editable(s):
    if s.exam.status not in ("Draft", "Slot Creation"): return "Booking has begun; slot can no longer be changed"
    if any(b.status != "Cancelled" for b in s.bookings): return "Slot already has bookings"
    return None


@bp.put("/slots/<int:sid>")
def slot_update(sid):
    s = db.get_or_404(Slot, sid)
    if s.examiner_id != current_user().id: return bad("Not your slot", 403)
    if (m := _editable(s)): return bad(m, 409)
    err = _apply_slot(s, body(), s.exam, current_user())
    if err: db.session.rollback(); return err
    db.session.commit(); invalidate("schedule")
    return jsonify(message="Updated")


@bp.delete("/slots/<int:sid>")
def slot_delete(sid):
    s = db.get_or_404(Slot, sid)
    if s.examiner_id != current_user().id: return bad("Not your slot", 403)
    if (m := _editable(s)): return bad(m, 409)
    Booking.query.filter_by(slot_id=sid).delete(); db.session.delete(s); db.session.commit(); invalidate("schedule")
    return jsonify(message="Deleted")


@bp.get("/slots/<int:sid>/bookings")
def slot_bookings(sid):
    s = db.get_or_404(Slot, sid)
    if s.examiner_id != current_user().id: return bad("Not your slot", 403)
    return jsonify([booking_dict(b) for b in s.bookings if b.status != "Cancelled"])


@bp.post("/slots/<int:sid>/complete")
def slot_complete(sid):
    s = db.get_or_404(Slot, sid)
    if s.examiner_id != current_user().id: return bad("Not your slot", 403)
    if any(b.status == "Booked" for b in s.bookings): return bad("Evaluate all booked students before completing the slot", 409)
    s.status = "Completed"; db.session.commit(); invalidate("schedule")
    return jsonify(message="Slot marked completed")


@bp.get("/bookings")
def bookings():
    qs = my_bookings(current_user().id)
    if request.args.get("pending") == "1": qs = qs.filter(Booking.status == "Booked")
    return jsonify([booking_dict(b) for b in qs.order_by(Slot.date, Slot.start_time)])


@bp.get("/bookings/<int:bid>/evaluation")
def get_evaluation(bid):
    b = db.get_or_404(Booking, bid)
    if b.slot.examiner_id != current_user().id: return bad("Not your student", 403)
    return jsonify(evaluation_dict(b.evaluation) if b.evaluation else None)


@bp.post("/bookings/<int:bid>/evaluate")
def evaluate(bid):
    u, d = current_user(), body()
    b = db.get_or_404(Booking, bid)
    if b.slot.examiner_id != u.id or b.status == "Cancelled": return bad("You can evaluate only students booked into your slots", 403)
    exam = b.exam
    if exam.status in ("Draft", "Slot Creation"): return bad("Examination has not started yet", 409)
    if exam.results_published: return bad("Results already published; evaluation is locked", 409)
    rubrics = Rubric.query.filter_by(exam_id=exam.id).all()
    scores = {}
    if rubrics:
        given = {int(x["rubric_id"]): x.get("marks") for x in d.get("scores", []) if "rubric_id" in x}
        wsum = psum = 0
        for r in rubrics:
            try: m = float(given[r.id])
            except (KeyError, TypeError, ValueError): return bad(f"Marks missing for '{r.criterion}'")
            if m < 0 or m > r.max_marks: return bad(f"Marks for '{r.criterion}' must be between 0 and {r.max_marks:g}")
            scores[r.id] = m; wsum += r.weightage; psum += (m / r.max_marks) * r.weightage
        total = round(psum / wsum * exam.max_marks, 2)
    else:
        try: total = float(d.get("total_marks"))
        except (TypeError, ValueError): return bad("Total marks required")
        if total < 0 or total > exam.max_marks: return bad(f"Marks must be between 0 and {exam.max_marks:g}")
    ev = b.evaluation or Evaluation(booking_id=b.id, student_id=b.student_id, examiner_id=u.id)
    ev.total_marks, ev.remarks, ev.status = total, (d.get("remarks") or "").strip(), "Submitted"
    ev.scores = [EvaluationScore(rubric_id=k, marks=v) for k, v in scores.items()]
    b.status = "Completed"
    db.session.add(ev); db.session.commit()
    return jsonify(total_marks=total, message="Evaluation saved")
