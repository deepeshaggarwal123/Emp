from flask import jsonify
from flask_jwt_extended import verify_jwt_in_request, get_jwt_identity
from models import db, User


def current_user():
    return db.session.get(User, int(get_jwt_identity()))


def guard(*roles):
    """Use in blueprint.before_request: returns an error response or None."""
    try:
        verify_jwt_in_request()
    except Exception as e:  # missing / expired / invalid token
        return jsonify(error=str(e)), 401
    u = current_user()
    if not u or not u.is_active:
        return jsonify(error="Account inactive or not found"), 403
    if roles and u.role not in roles:
        return jsonify(error="Forbidden for your role"), 403
    return None
