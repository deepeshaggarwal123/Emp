from flask import Blueprint, jsonify
from models import db, Course, Notification
from common import get_rubrics
from utils import guard, current_user

bp = Blueprint("misc", __name__, url_prefix="/api")


@bp.before_request
def _guard():
    return guard()


@bp.get("/courses")
def courses():
    return jsonify([dict(id=c.id, code=c.code, name=c.name) for c in Course.query.filter_by(status="Active").order_by(Course.code)])


@bp.get("/exams/<int:eid>/rubrics")
def rubrics(eid):
    return jsonify(get_rubrics(eid))


@bp.get("/notifications")
def notifications():
    u = current_user()
    items = Notification.query.filter_by(user_id=u.id).order_by(Notification.id.desc()).limit(20).all()
    return jsonify(unread=Notification.query.filter_by(user_id=u.id, is_read=False).count(),
                   items=[dict(id=n.id, message=n.message, is_read=n.is_read, created_at=n.created_at.isoformat()) for n in items])


@bp.post("/notifications/read")
def read_all():
    Notification.query.filter_by(user_id=current_user().id, is_read=False).update({"is_read": True})
    db.session.commit()
    return jsonify(message="ok")
