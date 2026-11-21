import os
from flask import Flask, jsonify, render_template
from flask_jwt_extended import JWTManager
from config import Config
from models import db, User
import auth, admin, examiner, student, misc

FRONTEND = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "frontend")


def seed_admin(app):
    """Create the single pre-existing admin programmatically."""
    if not User.query.filter_by(role="admin").first():
        a = User(name="Administrator", email=app.config["ADMIN_EMAIL"], role="admin")
        a.set_password(app.config["ADMIN_PASSWORD"])
        db.session.add(a)
        db.session.commit()


def create_app(config=Config):
    app = Flask(__name__, template_folder=FRONTEND, static_folder=os.path.join(FRONTEND, "static"))
    app.config.from_object(config)
    db.init_app(app)
    JWTManager(app)
    for m in (auth, admin, examiner, student, misc):
        app.register_blueprint(m.bp)

    @app.get("/")
    def index():  # Jinja2 is used only as the entry point; UI is Vue
        return render_template("index.html")

    @app.get("/api/health")
    def health():
        return jsonify(status="ok")

    @app.errorhandler(ValueError)
    def value_error(e):
        db.session.rollback()
        return jsonify(error=str(e)), 400

    @app.errorhandler(404)
    def nf(e):
        return jsonify(error="Not found"), 404

    with app.app_context():
        db.create_all()
        seed_admin(app)
    return app


if __name__ == "__main__":
    create_app().run(debug=True, port=5000)
