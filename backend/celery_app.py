"""Celery instance. Worker:  celery -A celery_app.celery worker -l info
Scheduler:  celery -A celery_app.celery beat -l info"""
import os
from celery import Celery, Task
from celery.schedules import crontab

REDIS = os.getenv("REDIS_URL", "redis://localhost:6379/0")
celery = Celery("emp", broker=REDIS, backend=REDIS, include=["tasks"])
celery.conf.timezone = os.getenv("TZ_NAME", "Asia/Kolkata")
celery.conf.beat_schedule = {
    "daily-exam-reminder": {"task": "tasks.daily_reminder", "schedule": crontab(hour=8, minute=0)},
    "monthly-admin-report": {"task": "tasks.monthly_report", "schedule": crontab(day_of_month=1, hour=7, minute=0)},
}

_flask_app = None


def flask_app():
    global _flask_app
    if _flask_app is None:
        from app import create_app
        _flask_app = create_app()
    return _flask_app


class ContextTask(Task):
    def __call__(self, *a, **kw):
        with flask_app().app_context():
            return self.run(*a, **kw)


celery.Task = ContextTask
