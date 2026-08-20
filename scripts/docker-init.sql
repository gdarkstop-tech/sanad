-- Runs once, when the Docker volume is first created.
-- `sanad_dev` already exists via POSTGRES_DB; the suite needs a second one.
CREATE DATABASE sanad_test;
