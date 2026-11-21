import re
from flask import Blueprint, request, jsonify
from flask_jwt_extended import create_access_token, jwt_required
from sqlalchemy.exc import IntegrityError
from models import db, User, StudentProfile
from utils import current_user

bp = Blueprint("auth", __name__, url_prefix="/api/auth")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


@bp.post("/register")
def register():
    """Self-registration is for students only."""
    d = request.get_json(silent=True) or {}
    name, email, pw = (d.get("name") or "").strip(), (d.get("email") or "").strip().lower(), d.get("password") or ""
    if not name or not EMAIL_RE.match(email) or len(pw) < 6:
        return jsonify(error="Valid name, email and a password of 6+ characters are required"), 400
    user = User(name=name, email=email, role="student", phone=d.get("phone"))
    user.set_password(pw)
    user.student_profile = StudentProfile(roll_no=d.get("roll_no"), program=d.get("program"))
    db.session.add(user)
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify(error="Email already registered"), 409
    return jsonify(message="Registered successfully", user=user.to_dict()), 201


@bp.post("/login")
def login():
    d = request.get_json(silent=True) or {}
    user = User.query.filter_by(email=(d.get("email") or "").strip().lower()).first()
    if not user or not user.check_password(d.get("password") or ""):
        return jsonify(error="Invalid credentials"), 401
    if not user.is_active:
        return jsonify(error="Account is deactivated"), 403
    token = create_access_token(identity=str(user.id), additional_claims={"role": user.role})
    return jsonify(access_token=token, user=user.to_dict())


@bp.get("/me")
@jwt_required()
def me():
    return jsonify(current_user().to_dict())


@bp.put("/me")
@jwt_required()
def update_me():
    d = request.get_json(silent=True) or {}
    u = current_user()
    if d.get("name"):
        u.name = d["name"].strip()
    if "phone" in d:
        u.phone = d["phone"]
    if d.get("password"):
        if len(d["password"]) < 6:
            return jsonify(error="Password must be 6+ characters"), 400
        u.set_password(d["password"])
    if u.student_profile:
        u.student_profile.roll_no = d.get("roll_no", u.student_profile.roll_no)
        u.student_profile.program = d.get("program", u.student_profile.program)
    db.session.commit()
    return jsonify(u.to_dict())
