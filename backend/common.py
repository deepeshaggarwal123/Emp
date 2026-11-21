from datetime import datetime, date, time
from flask import jsonify
from models import db, Notification, Rubric
from cache import cached


def bad(msg, code=400):
    return jsonify(error=msg), code


def iso(v):
    return v.isoformat() if v else None


def parse_dt(v):
    if not v:
        return None
    try:
        return datetime.fromisoformat(v)
    except ValueError:
        raise ValueError(f"Invalid date-time: {v}")


def parse_date(v):
    try:
        return date.fromisoformat(v)
    except (ValueError, TypeError):
        raise ValueError(f"Invalid date: {v}")


def parse_time(v):
    try:
        return time.fromisoformat(v)
    except (ValueError, TypeError):
        raise ValueError(f"Invalid time: {v}")


def notify(user_id, message):
    db.session.add(Notification(user_id=user_id, message=message[:300]))


# ---------- serializers ----------
def exam_dict(e):
    return dict(id=e.id, course_id=e.course_id, course_code=e.course.code, course_name=e.course.name,
                name=e.name, exam_type=e.exam_type, duration_minutes=e.duration_minutes,
                max_marks=e.max_marks, instructions=e.instructions,
                slot_creation_start=iso(e.slot_creation_start), slot_creation_end=iso(e.slot_creation_end),
                booking_start=iso(e.booking_start), booking_end=iso(e.booking_end),
                status=e.status, results_published=e.results_published,
                examiner_ids=[u.id for u in e.examiners], examiners=[u.name for u in e.examiners],
                booking_open=booking_open(e))


def slot_dict(s):
    return dict(id=s.id, exam_id=s.exam_id, exam_name=s.exam.name, examiner_id=s.examiner_id,
                examiner_name=s.examiner.name, date=iso(s.date), start_time=s.start_time.strftime("%H:%M"),
                end_time=s.end_time.strftime("%H:%M"), capacity=s.capacity,
                available_seats=s.available_seats, status=s.status, meeting_link=s.meeting_link)


def booking_dict(b):
    ev = b.evaluation
    return dict(id=b.id, student_id=b.student_id, student_name=b.student.name, student_email=b.student.email,
                exam_id=b.exam_id, exam_name=b.exam.name, course=b.exam.course.name, max_marks=b.exam.max_marks, status=b.status,
                booked_at=iso(b.booked_at), slot=slot_dict(b.slot), evaluated=ev is not None,
                results_published=b.exam.results_published)


def evaluation_dict(ev):
    return dict(id=ev.id, total_marks=ev.total_marks, remarks=ev.remarks, evaluated_at=iso(ev.evaluated_at),
                status=ev.status, max_marks=ev.booking.exam.max_marks, examiner=ev.booking.slot.examiner.name,
                scores=[dict(rubric_id=s.rubric_id, marks=s.marks) for s in ev.scores])


def get_rubrics(exam_id):
    """Cached rubric list for an exam."""
    def load():
        rs = Rubric.query.filter_by(exam_id=exam_id).order_by(Rubric.id).all()
        return [dict(id=r.id, exam_id=r.exam_id, criterion=r.criterion, max_marks=r.max_marks,
                     weightage=r.weightage, description=r.description) for r in rs]
    return cached(f"rubrics:{exam_id}", load)


# ---------- phase rules ----------
def _window(exam, status, start, end):
    now = datetime.now()
    return exam.status == status and not (start and now < start) and not (end and now > end)


def slot_creation_open(exam):
    return _window(exam, "Slot Creation", exam.slot_creation_start, exam.slot_creation_end)


def booking_open(exam):
    return _window(exam, "Booking Open", exam.booking_start, exam.booking_end)
