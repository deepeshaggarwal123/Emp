# Examination Management Portal (EMP)

A Flask + SQLite + Redis/Celery application for managing exams, bookings, evaluations, and result publication.

## Tech stack
- Backend: Flask, Flask-SQLAlchemy, Flask-JWT-Extended
- Database: SQLite
- Cache: Redis (optional)
- Background jobs: Celery + Redis (optional)
- Frontend: Vue 3 via CDN + Bootstrap

## 1) Requirements
Install these first:

- Python 3.10+
- Redis server (optional but needed for cache/background jobs)
- Git

## 2) Clone the project
```bash
git clone <repo-url>
cd emp
```

## 3) Create and activate virtual environment
### Windows (PowerShell)
```powershell
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
```

### Windows (Command Prompt)
```cmd
cd backend
python -m venv venv
venv\Scripts\activate.bat
```

### in window
```bash
cd backend

python -m venv venv

.\venv\Scripts\Activate.ps1

python -m pip install -r requirements.txt

python app.py

Then open:
```text
http://localhost:5000
```

This starts the application and serves the frontend automatically from the Flask app.

## 6) Default login
The app creates a default admin user on first run.

```text
Email: admin@emp.local
Password: admin123
```

You can override these values using environment variables before starting the app:

### Windows PowerShell
```powershell
$env:ADMIN_EMAIL="admin@emp.local"
$env:ADMIN_PASSWORD="admin123"
```

### Linux / macOS
```bash
export ADMIN_EMAIL="admin@emp.local"
export ADMIN_PASSWORD="admin123"
```

## 7) Optional: Redis and Celery for cache + background jobs
Without Redis, the app still runs, but caching and Celery jobs are skipped or limited.

### Start Redis
```bash
redis-server
```

### Start Celery worker (required for CSV export jobs)
#### Windows
```powershell
cd backend
.\venv\Scripts\Activate.ps1
celery -A celery_app.celery worker -l info --pool=solo
```

#### macOS / Linux
```bash
cd backend
source venv/bin/activate
celery -A celery_app.celery worker -l info
```

### Start Celery beat scheduler
```bash
cd backend
source venv/bin/activate
celery -A celery_app.celery beat -l info
```

The scheduler runs:
- daily exam reminders at 08:00
- monthly admin report on the 1st at 07:00

## 8) Optional email and chat notifications
Set environment variables before starting the app or worker, for example:

### Windows PowerShell
```powershell
$env:MAIL_HOST="localhost"
$env:MAIL_PORT="1025"
$env:GCHAT_WEBHOOK="https://chat.googleapis.com/your-webhook"
```

### macOS / Linux
```bash
export MAIL_HOST="localhost"
export MAIL_PORT="1025"
export GCHAT_WEBHOOK="https://chat.googleapis.com/your-webhook"
```

If the SMTP server is unavailable, mails are saved to:
```text
backend/outbox/*.html
```

## 9) Manually run demo/background jobs
This runs the reminder and report tasks directly:

```bash
cd backend
source venv/bin/activate
python -c "from celery_app import flask_app; import tasks; flask_app().app_context().push(); print(tasks.daily_reminder.run(), tasks.monthly_report.run())"
```

## 10) Full startup sequence (recommended)
### Windows PowerShell
```powershell
cd emp\backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
redis-server
# Terminal 2
celery -A celery_app.celery worker -l info --pool=solo
# Terminal 3
celery -A celery_app.celery beat -l info
# Terminal 4
python app.py
```

### macOS / Linux
```bash
cd emp/backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
redis-server
# Terminal 2
celery -A celery_app.celery worker -l info
# Terminal 3
celery -A celery_app.celery beat -l info
# Terminal 4
python app.py
```

## 11) Database
The SQLite database file is created automatically on first startup:

```text
backend/emp.db
```

## 12) Demo flow
1. Admin creates courses, examiners, examinations, and rubric criteria
2. Admin creates slot windows
3. Examiner creates exam slots
4. Admin opens booking
5. Students register and book available slots
6. Admin closes booking
7. Examiner evaluates students
8. Admin publishes results
9. Students view results and export CSV files

## 13) Useful API endpoints
- Auth:
  - POST /api/auth/register
  - POST /api/auth/login
  - GET /api/auth/me
  - PUT /api/auth/me
- Shared:
  - GET /api/courses
  - GET /api/exams/<id>/rubrics
  - GET /api/notifications
  - POST /api/notifications/read
- Admin:
  - GET /api/admin/stats
  - GET /api/admin/search
  - CRUD routes for courses, exams, examiners, students, slots, and bookings
- Examiner:
  - GET /api/examiner/dashboard
  - CRUD slot routes
  - POST /api/examiner/slots/<id>/complete
  - POST /api/examiner/bookings/<id>/evaluate
- Student:
  - GET /api/student/dashboard
  - GET /api/student/exams
  - POST /api/student/slots/<id>/book
  - POST /api/student/bookings/<id>/cancel

## 14) Troubleshooting
- If `flask` is not found, reinstall dependencies inside the virtual environment:
  ```bash
  pip install -r requirements.txt
  ```
- If Redis is not running, start it with `redis-server`.
- If Celery worker fails on Windows, use:
  ```bash
  --pool=solo
  ```
- If the app cannot send emails, it will save them as HTML files under `backend/outbox`.

## 15) Stop the app
Press `Ctrl + C` in the terminal where `python app.py` is running.

