CREATE TABLE login_attempts (
    ip TEXT PRIMARY KEY,
    attempts INTEGER DEFAULT 0,
    first_attempt_at INTEGER
);