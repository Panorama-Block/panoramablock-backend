SELECT 'CREATE ROLE tac_service WITH LOGIN PASSWORD ''tac_service_password''' 
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'tac_service') \gexec

SELECT 'CREATE DATABASE tac_service OWNER tac_service'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'tac_service') \gexec

-- Shared DB for other backend services (local dev)
-- NOTE: CREATE DATABASE cannot run inside a DO $$ block; use \gexec (psql) instead.
SELECT format('CREATE DATABASE panorama_dca OWNER %I', current_user)
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'panorama_dca') \gexec

-- Shared DB for the generic Panorama data gateway used by Zico chat persistence.
SELECT format('CREATE DATABASE panorama_data_gateway OWNER %I', current_user)
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'panorama_data_gateway') \gexec

\connect tac_service

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "btree_gin";
