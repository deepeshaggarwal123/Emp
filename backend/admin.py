from datetime import datetime, timedelta
from flask import Blueprint, request, jsonify
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from models import (db, User, ExaminerProfile, Course, Exam, Rubric, Slot, Booking, Evaluation,
                    EXAM_TYPES)
from common import *
from utils import guard
from cache import invalidate

bp = Blueprint("admin", __name__, url_prefix="/api/admin")


@bp.before_request
def _guard():
    return guard("admin")


def body():
    return request.get_json(silent=True) or {}


# ---------------- dashboard ----------------
@bp.get("/stats")
def stats():
    active = Booking.status != "Cancelled"
    by_exam = (db.session.query(Exam.name, func.count(Booking.id)).join(Booking, Booking.exam_id == Exam.id)
               .filter(active).group_by(Exam.id).order_by(func.count(Booking.id).desc()).limit(8).all())
    workload = (db.session.query(User.name, func.count(Booking.id)).join(Slot, Slot.examiner_id == User.id)
                .join(Booking, Booking.slot_id == Slot.id).filter(active).group_by(User.id)
                .order_by(func.count(Booking.id).desc()).limit(8).all())
    since = datetime.utcnow() - timedelta(days=13)
    counts = {}
    for (b,) in db.session.query(Booking.booked_at).filter(active, Booking.booked_at >= since):
        counts[b.date().isoformat()] = counts.get(b.date().isoformat(), 0) + 1
    trend = [((since + timedelta(days=i)).date().isoformat()) for i in range(14)]
    return jsonify(
        courses=Course.query.count(), exams=Exam.query.count(),
        students=User.query.filter_by(role="student").count(),
        examiners=User.query.filter_by(role="examiner").count(),
        slots=Slot.query.count(), bookings=Booking.query.filter(active).count(),
        pending_evaluations=Booking.query.filter_by(status="Booked").count(),
        popular_exams=[dict(name=n, count=c) for n, c in by_exam],
        examiner_workload=[dict(name=n, count=c) for n, c in workload],
        booking_trend=[dict(date=d, count=counts.get(d, 0)) for d in trend])


# ---------------- courses ----------------
@bp.get("/courses")
def courses():
    q = (request.args.get("q") or "").strip()
    qs = Course.query
    if q:
        qs = qs.filter(or_(Course.name.ilike(f"%{q}%"), Course.code.ilike(f"%{q}%")))
    return jsonify([dict(id=c.id, code=c.code, name=c.name, description=c.description, status=c.status,
                         exam_count=len(c.exams)) for c in qs.order_by(Course.code)])


def _apply_course(c, d):
    code, name = (d.get("code") or "").strip().upper(), (d.get("name") or "").strip()
    if not code or not name:
        return bad("Course code and name are required")
    if Course.query.filter(Course.code == code, Course.id != (c.id or 0)).first():
        return bad("Course code already exists", 409)
    c.code, c.name, c.description = code, name, d.get("description")
    c.status = d.get("status") if d.get("status") in ("Active", "Inactive") else (c.status or "Active")


@bp.post("/courses")
def course_create():
    c = Course(); err = _apply_course(c, body())
    if err: return err
    db.session.add(c); db.session.commit(); invalidate("exams")
    return jsonify(id=c.id), 201


@bp.put("/courses/<int:cid>")
def course_update(cid):
    c = db.get_or_404(Course, cid); err = _apply_course(c, body())
    if err: return err
    db.session.commit(); invalidate("exams")
    return jsonify(message="Updated")


@bp.delete("/courses/<int:cid>")
def course_delete(cid):
    c = db.get_or_404(Course, cid)
    if c.exams:
        return bad("Course has examinations; mark it Inactive instead", 409)
    db.session.delete(c); db.session.commit()
    return jsonify(message="Deleted")


# ---------------- exams ----------------
def _apply_exam(e, d):
    course = db.session.get(Course, d.get("course_id") or 0)
    name = (d.get("name") or "").strip()
    if not course: return bad("Valid course is required")
    if not name: return bad("Examination name is required")
    if d.get("exam_type") not in EXAM_TYPES: return bad("Invalid examination type")
    try:
        dur, mx = int(d.get("duration_minutes")), float(d.get("max_marks"))
    except (TypeError, ValueError):
        return bad("Duration and maximum marks must be numbers")
    if dur <= 0 or mx <= 0: return bad("Duration and maximum marks must be positive")
    f = {k: parse_dt(d.get(k)) for k in ("slot_creation_start", "slot_creation_end", "booking_start", "booking_end")}
    for a, b in (("slot_creation_start", "slot_creation_end"), ("booking_start", "booking_end")):
        if f[a] and f[b] and f[b] < f[a]:
            return bad(f"{b.replace('_', ' ')} must be after {a.replace('_', ' ')}")
    e.course_id, e.name, e.exam_type, e.duration_minutes, e.max_marks = course.id, name, d["exam_type"], dur, mx
    e.instructions = d.get("instructions")
    for k, v in f.items(): setattr(e, k, v)
    if "examiner_ids" in d:
        e.examiners = User.query.filter(User.id.in_(d["examiner_ids"] or []), User.role == "examiner").all()


@bp.get("/exams")
def exams():
    q, st, cid = (request.args.get("q") or "").strip(), request.args.get("status"), request.args.get("course_id")
    qs = Exam.query.join(Course)
    if q: qs = qs.filter(or_(Exam.name.ilike(f"%{q}%"), Course.name.ilike(f"%{q}%"), Course.code.ilike(f"%{q}%")))
    if st: qs = qs.filter(Exam.status == st)
    if cid: qs = qs.filter(Exam.course_id == int(cid))
    return jsonify([exam_dict(e) for e in qs.order_by(Exam.id.desc())])


@bp.post("/exams")
def exam_create():
    e = Exam(status="Draft"); err = _apply_exam(e, body())
    if err: return err
    db.session.add(e); db.session.commit(); invalidate("exams")
    return jsonify(id=e.id), 201


@bp.put("/exams/<int:eid>")
def exam_update(eid):
    e = db.get_or_404(Exam, eid); err = _apply_exam(e, body())
    if err: return err
    db.session.commit(); invalidate("exams", "schedule")
    return jsonify(message="Updated")


@bp.delete("/exams/<int:eid>")
def exam_delete(eid):
    e = db.get_or_404(Exam, eid)
    if Booking.query.filter_by(exam_id=eid).first():
        return bad("Examination has bookings and cannot be deleted", 409)
    Slot.query.filter_by(exam_id=eid).delete()
    db.session.delete(e); db.session.commit(); invalidate("exams", "schedule", "rubrics")
    return jsonify(message="Deleted")


TRANSITIONS = {  # action: (allowed current statuses, new status)
    "open_slots": ({"Draft"}, "Slot Creation"),
    "close_slots": ({"Slot Creation"}, "Draft"),
    "open_booking": ({"Draft", "Slot Creation", "Closed"}, "Booking Open"),
    "close_booking": ({"Booking Open"}, "Closed"),
    "complete": ({"Booking Open", "Closed"}, "Completed"),
}


@bp.post("/exams/<int:eid>/phase")
def exam_phase(eid):
    e, action = db.get_or_404(Exam, eid), body().get("action")
    if action not in TRANSITIONS: return bad("Unknown action")
    allowed, new = TRANSITIONS[action]
    if e.status not in allowed: return bad(f"Cannot {action.replace('_', ' ')} while exam is '{e.status}'", 409)
    e.status = new
    if action == "complete":
        for s in Slot.query.filter(Slot.exam_id == eid, Slot.status != "Cancelled"): s.status = "Completed"
    db.session.commit(); invalidate("exams", "schedule")
    return jsonify(status=e.status)


@bp.post("/exams/<int:eid>/publish")
def exam_publish(eid):
    e = db.get_or_404(Exam, eid)
    if e.status not in ("Closed", "Completed"):
        return bad("Close booking (or complete the exam) before publishing results", 409)
    e.results_published = True
    evs = Evaluation.query.join(Booking).filter(Booking.exam_id == eid).all()
    for ev in evs:
        notify(ev.student_id, f"Results published for {e.name}: {ev.total_marks}/{e.max_marks}")
    db.session.commit()
    try:  # email students via Celery (best effort)
        from tasks import notify_results
        notify_results.apply_async(args=[eid], retry=False)
    except Exception:
        pass
    return jsonify(message=f"Results published for {len(evs)} student(s)")


# ---------------- rubrics ----------------
@bp.get("/exams/<int:eid>/rubrics")
def rubrics(eid):
    return jsonify(get_rubrics(eid))


def _apply_rubric(r, d):
    name = (d.get("criterion") or "").strip()
    try: mx, w = float(d.get("max_marks")), float(d.get("weightage") or 1)
    except (TypeError, ValueError): return bad("Marks and weightage must be numbers")
    if not name or mx <= 0 or w <= 0: return bad("Criterion name, positive marks and weightage are required")
    r.criterion, r.max_marks, r.weightage, r.description = name, mx, w, d.get("description")


@bp.post("/exams/<int:eid>/rubrics")
def rubric_create(eid):
    db.get_or_404(Exam, eid); r = Rubric(exam_id=eid); err = _apply_rubric(r, body())
    if err: return err
    db.session.add(r); db.session.commit(); invalidate(f"rubrics:{eid}")
    return jsonify(id=r.id), 201


@bp.put("/rubrics/<int:rid>")
def rubric_update(rid):
    r = db.get_or_404(Rubric, rid); err = _apply_rubric(r, body())
    if err: return err
    db.session.commit(); invalidate(f"rubrics:{r.exam_id}")
    return jsonify(message="Updated")


@bp.delete("/rubrics/<int:rid>")
def rubric_delete(rid):
    r = db.get_or_404(Rubric, rid)
    from models import EvaluationScore
    if EvaluationScore.query.filter_by(rubric_id=rid).first():
        return bad("Rubric already used in evaluations", 409)
    eid = r.exam_id; db.session.delete(r); db.session.commit(); invalidate(f"rubrics:{eid}")
    return jsonify(message="Deleted")


# ---------------- examiners & students ----------------
def _user_list(role, q):
    qs = User.query.filter_by(role=role)
    if q: qs = qs.filter(or_(User.name.ilike(f"%{q}%"), User.email.ilike(f"%{q}%")))
    return qs.order_by(User.name)


@bp.get("/examiners")
def examiners():
    out = []
    for u in _user_list("examiner", (request.args.get("q") or "").strip()):
        p = u.examiner_profile
        out.append({**u.to_dict(), "department": p.department if p else None,
                    "slots": Slot.query.filter_by(examiner_id=u.id).count()})
    return jsonify(out)


@bp.post("/examiners")
def examiner_create():
    d = body(); name, email, pw = (d.get("name") or "").strip(), (d.get("email") or "").strip().lower(), d.get("password") or ""
    if not name or "@" not in email or len(pw) < 6: return bad("Name, valid email and 6+ char password required")
    u = User(name=name, email=email, role="examiner", phone=d.get("phone")); u.set_password(pw)
    u.examiner_profile = ExaminerProfile(department=d.get("department"))
    db.session.add(u)
    try: db.session.commit()
    except IntegrityError:
        db.session.rollback(); return bad("Email already registered", 409)
    return jsonify(id=u.id), 201


@bp.put("/examiners/<int:uid>")
def examiner_update(uid):
    u = db.get_or_404(User, uid); d = body()
    if u.role != "examiner": return bad("Not an examiner", 404)
    u.name = (d.get("name") or u.name).strip(); u.phone = d.get("phone", u.phone)
    if "is_active" in d:
        u.is_active = bool(d["is_active"])
        if u.examiner_profile: u.examiner_profile.status = "Active" if u.is_active else "Inactive"
    if d.get("password"):
        if len(d["password"]) < 6: return bad("Password must be 6+ characters")
        u.set_password(d["password"])
    if u.examiner_profile: u.examiner_profile.department = d.get("department", u.examiner_profile.department)
    db.session.commit()
    return jsonify(message="Updated")


@bp.get("/students")
def students():
    out = []
    for u in _user_list("student", (request.args.get("q") or "").strip()):
        p = u.student_profile
        out.append({**u.to_dict(), "roll_no": p.roll_no if p else None, "program": p.program if p else None,
                    "bookings": Booking.query.filter(Booking.student_id == u.id, Booking.status != "Cancelled").count()})
    return jsonify(out)


@bp.put("/students/<int:uid>")
def student_update(uid):
    u = db.get_or_404(User, uid)
    if u.role != "student": return bad("Not a student", 404)
    u.is_active = bool(body().get("is_active", u.is_active)); db.session.commit()
    return jsonify(message="Updated")


# ---------------- slots & bookings ----------------
@bp.get("/slots")
def slots():
    qs = Slot.query
    if request.args.get("exam_id"): qs = qs.filter(Slot.exam_id == int(request.args["exam_id"]))
    if request.args.get("examiner_id"): qs = qs.filter(Slot.examiner_id == int(request.args["examiner_id"]))
    return jsonify([slot_dict(s) for s in qs.order_by(Slot.date, Slot.start_time).limit(500)])


@bp.put("/slots/<int:sid>")
def slot_reschedule(sid):
    """Exceptional rescheduling of a slot's date/time/link."""
    s, d = db.get_or_404(Slot, sid), body()
    s.date = parse_date(d.get("date")) if d.get("date") else s.date
    s.start_time = parse_time(d["start_time"]) if d.get("start_time") else s.start_time
    s.end_time = parse_time(d["end_time"]) if d.get("end_time") else s.end_time
    if s.end_time <= s.start_time: db.session.rollback(); return bad("End time must be after start time")
    s.meeting_link = d.get("meeting_link", s.meeting_link)
    for b in s.bookings:
        if b.status == "Booked": notify(b.student_id, f"{s.exam.name} slot rescheduled to {s.date} {s.start_time:%H:%M}")
    db.session.commit(); invalidate("schedule")
    return jsonify(message="Slot rescheduled")


@bp.put("/slots/<int:sid>/examiner")
def slot_change_examiner(sid):
    s = db.get_or_404(Slot, sid)
    ex = db.session.get(User, body().get("examiner_id") or 0)
    if not ex or ex.role != "examiner" or not ex.is_active: return bad("Valid active examiner required")
    if Evaluation.query.join(Booking).filter(Booking.slot_id == sid).first():
        return bad("Slot already has evaluations; examiner cannot be changed", 409)
    if ex not in s.exam.examiners: s.exam.examiners.append(ex)
    s.examiner_id = ex.id
    for b in s.bookings:
        if b.status == "Booked": notify(b.student_id, f"Examiner for {s.exam.name} changed to {ex.name}")
    db.session.commit(); invalidate("schedule")
    return jsonify(message="Examiner changed")


@bp.get("/bookings")
def bookings():
    q, st = (request.args.get("q") or "").strip(), request.args.get("status")
    qs = Booking.query.join(User, Booking.student_id == User.id).join(Exam, Booking.exam_id == Exam.id)
    if q: qs = qs.filter(or_(User.name.ilike(f"%{q}%"), User.email.ilike(f"%{q}%"), Exam.name.ilike(f"%{q}%")))
    if st: qs = qs.filter(Booking.status == st)
    if request.args.get("exam_id"): qs = qs.filter(Booking.exam_id == int(request.args["exam_id"]))
    return jsonify([booking_dict(b) for b in qs.order_by(Booking.id.desc()).limit(500)])


@bp.put("/bookings/<int:bid>/reschedule")
def booking_reschedule(bid):
    """Move a booking to another slot (different time or different examiner) of the same exam."""
    b = db.get_or_404(Booking, bid); new = db.session.get(Slot, body().get("slot_id") or 0)
    if b.status != "Booked": return bad("Only active bookings can be moved", 409)
    if b.evaluation: return bad("Booking already evaluated", 409)
    if not new or new.exam_id != b.exam_id: return bad("Target slot must belong to the same examination")
    if new.id == b.slot_id: return bad("Booking is already in that slot")
    got = Slot.query.filter(Slot.id == new.id, Slot.available_seats > 0, Slot.status == "Available") \
        .update({Slot.available_seats: Slot.available_seats - 1}, synchronize_session=False)
    if not got: return bad("Target slot is full or unavailable", 409)
    Slot.query.filter(Slot.id == new.id, Slot.available_seats == 0).update({Slot.status: "Full"}, synchronize_session=False)
    old = b.slot
    Slot.query.filter(Slot.id == old.id).update({Slot.available_seats: Slot.available_seats + 1}, synchronize_session=False)
    Slot.query.filter(Slot.id == old.id, Slot.status == "Full").update({Slot.status: "Available"}, synchronize_session=False)
    b.slot_id = new.id
    notify(b.student_id, f"Your {b.exam.name} booking was moved to {new.date} {new.start_time:%H:%M}")
    db.session.commit(); invalidate("schedule")
    return jsonify(message="Booking rescheduled")


# ---------------- global search ----------------
@bp.get("/search")
def search():
    q = (request.args.get("q") or "").strip()
    if len(q) < 2: return bad("Enter at least 2 characters")
    like = f"%{q}%"
    people = lambda role: [u.to_dict() for u in User.query.filter(User.role == role, or_(User.name.ilike(like), User.email.ilike(like))).limit(10)]
    ex = Exam.query.join(Course).filter(or_(Exam.name.ilike(like), Course.name.ilike(like), Course.code.ilike(like))).limit(10)
    bk = (Booking.query.join(User, Booking.student_id == User.id).join(Exam, Booking.exam_id == Exam.id)
          .filter(or_(User.name.ilike(like), User.email.ilike(like), Exam.name.ilike(like))).limit(10))
    return jsonify(students=people("student"), examiners=people("examiner"),
                   exams=[exam_dict(e) for e in ex], bookings=[booking_dict(b) for b in bk])
