[![Build and Test](https://github.com/WDP301-SP26/BE-repo/actions/workflows/build-and-test.yml/badge.svg)](https://github.com/WDP301-SP26/BE-repo/actions/workflows/build-and-test.yml)
[![Test and Build Docker](https://github.com/WDP301-SP26/BE-repo/actions/workflows/test-build-docker.yml/badge.svg)](https://github.com/WDP301-SP26/BE-repo/actions/workflows/test-build-docker.yml)

# WDP301 Backend API

A robust backend API built with NestJS framework, featuring comprehensive authentication, OAuth 2.0 integration, and modern development practices.

## 📋 Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
  - [Option 1: Docker Compose (Recommended)](#option-1-docker-compose-recommended)
  - [Option 2: Local Development](#option-2-local-development)
- [Environment Configuration](#environment-configuration)
- [Database Setup](#database-setup)
- [OAuth Configuration](#oauth-configuration)
  - [GitHub OAuth Setup](#github-oauth-setup)
  - [Jira OAuth Setup](#jira-oauth-setup)
- [API Testing](#api-testing)
- [Development Commands](#development-commands)
- [Troubleshooting](#troubleshooting)
- [Project Structure](#project-structure)
- [Contributing](#contributing)
- [Documentation](#documentation)

---

## ✨ Features

- ✅ **JWT-based Authentication** - Secure token-based authentication
- ✅ **Email/Password Registration & Login** - Traditional authentication flow
- ✅ **OAuth 2.0 Integration** - GitHub and Jira/Atlassian OAuth support
- ✅ **Account Linking** - Link multiple OAuth providers to a single account
- ✅ **Hybrid Authentication** - Combine email/password with OAuth providers
- ✅ **Swagger API Documentation** - Interactive API documentation with testing interface
- ✅ **Docker Support** - Containerized development and deployment
- ✅ **Database Migrations** - Version-controlled schema management with TypeORM
- ✅ **Group Management** - CRUD operations + member management with role-based authorization
- ✅ **Redis Caching** - Session and data caching with Redis
- ✅ **Role-Based Access Control** - Student, Group Leader, Lecturer, Admin roles
- ✅ **Health Checks** - Application health monitoring endpoints
- ✅ **CI/CD Pipelines** - Automated testing and Docker builds

---

## 🛠️ Tech Stack

| Category | Technology |
|----------|-----------|
| **Framework** | NestJS |
| **Language** | TypeScript |
| **Database** | PostgreSQL 15 |
| **ORM** | TypeORM |
| **Caching** | Redis (ioredis) |
| **Authentication** | JWT, Passport.js |
| **OAuth Providers** | GitHub, Jira/Atlassian |
| **API Documentation** | Swagger/OpenAPI |
| **Containerization** | Docker, Docker Compose |
| **Testing** | Jest |

---

## Semester Roster APIs

Admin semester roster management is exposed under ` /api/admin/semesters/:semesterId `:

- `GET /classes`
  - lists classes in the selected semester
- `POST /classes`
  - creates a new class inside the selected semester
- `PATCH /classes/:classId`
  - updates class code, name, or enrollment key
- `DELETE /classes/:classId`
  - deletes a semester class only when it has no students, groups, or assignment data
- `GET /roster`
  - returns semester roster snapshot for lecturers, students, and classes
- `POST /roster/lecturers`
  - creates a lecturer account for semester teaching/examiner assignment
- `PATCH /roster/lecturers/:userId`
  - updates lecturer profile data
- `DELETE /roster/lecturers/:userId`
  - deletes lecturer only when not assigned to teaching/examiner duties
- `POST /roster/students`
  - creates a student account and enrolls it into a class in the semester
- `PATCH /roster/students/:userId`
  - updates student profile or moves class membership within the semester
- `DELETE /roster/students/:userId`
  - removes student from semester roster by deleting semester-scoped class membership
- `PATCH /teaching-assignments`
  - bulk reassigns lecturers to classes; keeps `Class.lecturer_id` and `TeachingAssignment` in sync
- `GET /examiner-assignments`
  - returns examiner assignment board with current week gate information
- `PATCH /examiner-assignments`
  - replaces examiner assignments for the selected classes; blocked before week 10 and rejects lecturer-own-class conflicts

Key rules:

- Legacy lecturer class creation endpoint is blocked; class creation is Admin-only inside semester management.
- Semester roster editing is allowed only for `UPCOMING` and `ACTIVE`.
- Examiner assignment opens only when `semester.current_week >= 10`.
- A lecturer cannot examine a class they are currently teaching.

---

## 📦 Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** 20+ ([Download](https://nodejs.org/))
- **npm** or **pnpm** (comes with Node.js)
- **Docker Desktop** ([Download](https://www.docker.com/products/docker-desktop/))
- **Git** ([Download](https://git-scm.com/))
- **PostgreSQL 15** (optional if using Docker)

---

## 🚀 Quick Start

### Option 1: Docker Compose (Recommended)

Perfect for getting started quickly with zero configuration.

```bash
# 1. Clone the repository
git clone https://github.com/WDP301-SP26/BE-repo.git
cd BE-repo

# 2. Copy environment file
cp .env.example .env

# 3. Start all services (PostgreSQL + API)
docker-compose up -d

# 4. Run database migrations
docker exec -it wdp391-api npm run typeorm:migration:run

# 5. Open Swagger documentation
# Visit: http://localhost:3000/api/docs
```

**That's it!** Your API is running at `http://localhost:3000`

---

### Option 2: Local Development

For developers who prefer running services locally.

```bash
# 1. Clone the repository
git clone https://github.com/WDP301-SP26/BE-repo.git
cd BE-repo

# 2. Install dependencies
npm install

# 3. Copy environment file
cp .env.example .env
# Edit .env with your database credentials

# 4. Start PostgreSQL (using Docker)
docker run -d \
  --name postgres-dev \
  -e POSTGRES_USER=wdp391 \
  -e POSTGRES_PASSWORD=wdp391password \
  -e POSTGRES_DB=wdp391_db \
  -p 5432:5432 \
  postgres:15-alpine

# 5. Run database migrations
npm run typeorm:migration:run

# 6. Start development server
npm run start:dev

# 7. Open Swagger documentation
# Visit: http://localhost:3000/api/docs
```

---

## ⚙️ Environment Configuration

Create a `.env` file in the root directory with the following variables:

```env
# Database Configuration
DATABASE_URL="postgresql://wdp391:wdp391password@localhost:5432/wdp391_db?schema=public"

# JWT Configuration
JWT_SECRET=your-super-secret-key-change-in-production-min-32-chars
JWT_EXPIRES_IN=7d

# GitHub OAuth (Optional - leave empty if not using)
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
GITHUB_CALLBACK_URL=http://localhost:3000/api/auth/github/callback

# Jira OAuth (Optional - leave empty if not using)
JIRA_CLIENT_ID=your_jira_client_id
JIRA_CLIENT_SECRET=your_jira_client_secret
JIRA_CALLBACK_URL=http://localhost:3000/api/auth/jira/callback

# Frontend URL (for OAuth redirects)
FRONTEND_URL=http://localhost:5173

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# CORS Configuration
ALLOWED_CORS_ORIGINS=http://localhost:3000

# Server Configuration
PORT=3000
NODE_ENV=development
```

**Important Notes:**
- Change `JWT_SECRET` to a strong, random string (minimum 32 characters)
- Update database credentials if using custom PostgreSQL setup
- OAuth credentials are optional for basic authentication testing

---

## 🗄️ Database Setup

### Common Database Commands

```bash
# Generate a new migration from entity changes
npm run typeorm:migration:generate -- -n <MigrationName>

# Apply pending migrations
npm run typeorm:migration:run

# Revert the last applied migration
npm run typeorm:migration:revert

# Log the SQL that would be executed to sync schema
npm run typeorm:schema:log
```

### Database Management Tools

You can also connect to PostgreSQL using GUI tools:

| Tool | Connection String |
|------|-------------------|
| **DBeaver** | `postgresql://wdp391:wdp391password@localhost:5432/wdp391_db` |
| **TablePlus** | Host: `localhost`, Port: `5432`, User: `wdp391`, Password: `wdp391password` |
| **pgAdmin** | Same as above |

---

## 🔐 OAuth Configuration

### GitHub OAuth Setup

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Click **"New OAuth App"**
3. Fill in the application details:
   - **Application name**: `WDP391 Local Dev`
   - **Homepage URL**: `http://localhost:3000`
   - **Authorization callback URL**: `http://localhost:3000/api/auth/github/callback`
4. Click **"Register application"**
5. Copy the **Client ID** and **Client Secret**
6. Add them to your `.env` file:
   ```env
   GITHUB_CLIENT_ID=your_client_id_here
   GITHUB_CLIENT_SECRET=your_client_secret_here
   ```

**Testing GitHub OAuth:**
- Open browser: `http://localhost:3000/api/auth/github`
- Login with GitHub and authorize the app
- You'll be redirected with an authentication token

---

### Jira OAuth Setup

1. Go to [Atlassian Developer Console](https://developer.atlassian.com/console/myapps/)
2. Click **"Create"** → **"OAuth 2.0 integration"**
3. Fill in the app details:
   - **App name**: `WDP391 Local Dev`
4. Add **OAuth 2.0 (3LO)** callback URL:
   - `http://localhost:3000/api/auth/jira/callback`
5. Add required scopes:
   - `read:me`
   - `offline_access`
6. Copy the **Client ID** and **Client Secret**
7. Add them to your `.env` file:
   ```env
   JIRA_CLIENT_ID=your_client_id_here
   JIRA_CLIENT_SECRET=your_client_secret_here
   ```

**Testing Jira OAuth:**
- Open browser: `http://localhost:3000/api/auth/jira`
- Login with Atlassian account and authorize the app
- You'll be redirected with an authentication token

---

## 🧪 API Testing

### Using Swagger UI (Recommended)

1. **Start the server** (if not already running)
2. **Open Swagger**: http://localhost:3000/api/docs
3. **Test Authentication Flow**:

#### Step 1: Register a New User

- Endpoint: `POST /auth/register`
- Click **"Try it out"**
- Request body:
  ```json
  {
    "email": "test@example.com",
    "password": "password123",
    "full_name": "Test User",
    "student_id": "SE123456"
  }
  ```
- Click **"Execute"**
- Copy the `access_token` from the response

#### Step 2: Authorize Swagger

- Click the **"Authorize"** button (lock icon) at the top
- Enter: `Bearer YOUR_ACCESS_TOKEN`
- Click **"Authorize"** → **"Close"**

#### Step 3: Test Protected Endpoints

- Try `GET /auth/me` to view your profile
- Try `GET /auth/linked-accounts` to see connected OAuth accounts
- All requests now include your authentication token

### Quick Testing Commands

```bash
# Register a user
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"pass123","full_name":"Test User","student_id":"SE123"}'

# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"pass123"}'

# Get profile (replace TOKEN with your access_token)
curl http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer TOKEN"
```

### Testing OAuth Flows

OAuth flows require browser interaction and cannot be tested directly in Swagger:

1. **OAuth Login Flow** (New User):
   - Visit: `http://localhost:3000/api/auth/github` (or `/jira`)
   - Authorize the application
   - System creates account and returns token

2. **OAuth Account Linking** (Existing User):
   - Login first and get JWT token
   - Add token to Authorization header
   - Visit: `http://localhost:3000/api/auth/github` (or `/jira`)
   - Authorize to link account

For more testing scenarios, explore the Swagger UI interface at http://localhost:3000/api/docs

---

## 💻 Development Commands

### Running the Application

```bash
# Development mode (with hot reload)
npm run start:dev

# Production mode
npm run start:prod

# Debug mode
npm run start:debug
```

### Testing

```bash
# Run all unit tests
npm test

# Run tests in watch mode
npm run test:watch

# Run e2e tests
npm run test:e2e

# Generate test coverage report
npm run test:cov
```

### Docker Commands

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# View logs for specific service
docker-compose logs -f api

# Restart services
docker-compose restart

# Stop services
docker-compose stop

# Stop and remove containers (keeps data)
docker-compose down

# Stop and remove everything including volumes (deletes database)
docker-compose down -v

# Rebuild after code changes
docker-compose up -d --build

# Access API container shell
docker exec -it wdp391-api sh

# Access PostgreSQL container
docker exec -it wdp391-postgres psql -U wdp391 -d wdp391_db
```

### TypeORM Commands

```bash
# Generate a new migration from entity changes
npm run typeorm:migration:generate -- -n <MigrationName>

# Apply pending migrations
npm run typeorm:migration:run

# Revert the last applied migration
npm run typeorm:migration:revert

# Log the SQL that would be executed to sync schema
npm run typeorm:schema:log
```

---

## 🐛 Troubleshooting

### Port 3000 Already in Use

**Windows:**
```powershell
# Find process using port 3000
netstat -ano | findstr :3000

# Kill the process (replace PID with actual process ID)
taskkill /PID <PID> /F
```

**macOS/Linux:**
```bash
lsof -ti:3000 | xargs kill -9
```

**Alternative:** Change port in `.env`:
```env
PORT=3001
```

---

### Port 5432 Already in Use (PostgreSQL)

**Option 1: Stop local PostgreSQL**
```bash
# macOS
brew services stop postgresql

# Linux
sudo systemctl stop postgresql

# Windows (as Administrator)
net stop postgresql-x64-15
```

**Option 2: Use different port**

Update `docker-compose.yml`:
```yaml
postgres:
  ports:
    - "5433:5432"
```

Update `.env`:
```env
DATABASE_URL="postgresql://wdp391:wdp391password@localhost:5433/wdp391_db?schema=public"
```

---

### Database Connection Failed

```bash
# Check if PostgreSQL is running
docker ps | grep postgres

# Check PostgreSQL logs
docker-compose logs postgres

# Verify DATABASE_URL in .env matches your setup
# Ensure host, port, username, password are correct
```

---

### OAuth Redirect Not Working

1. **Check callback URLs** match exactly in:
   - `.env` file
   - OAuth app settings (GitHub/Jira)
2. **Verify OAuth credentials** are correct
3. **Ensure frontend URL** is configured if using separate frontend
4. **Check browser console** for CORS errors

---

### Docker Container Won't Start

```bash
# View detailed logs
docker-compose logs api

# Common issues:
# 1. Syntax errors in code
# 2. Database not ready yet (wait 10-15 seconds)
# 3. Missing environment variables
# 4. Port conflicts

# Rebuild from scratch
docker-compose down -v
docker-compose up -d --build
```

---

### Cannot Access Swagger UI

1. **Verify server is running**: Check `http://localhost:3000/health`
2. **Check port**: Ensure PORT in `.env` matches URL
3. **Clear browser cache**: Try incognito/private mode
4. **Check CORS settings**: If accessing from different domain

---

### Migration Errors

```bash
# Apply pending migrations
npm run typeorm:migration:run

# Revert the last migration if something went wrong
npm run typeorm:migration:revert

# Check what SQL TypeORM would generate to sync schema
npm run typeorm:schema:log
```

For additional troubleshooting tips, check the Docker logs: `docker-compose logs -f`

---

## 📁 Project Structure

```
BE-repo/
├── src/
│   ├── main.ts                    # Application entry point
│   ├── app.module.ts              # Root module (TypeORM config)
│   ├── swagger.ts                 # Swagger configuration
│   ├── entities/                  # TypeORM entity classes
│   │   ├── user.entity.ts
│   │   ├── integration-token.entity.ts
│   │   ├── group.entity.ts
│   │   ├── group-membership.entity.ts
│   │   └── index.ts
│   ├── common/
│   │   ├── constants/             # Centralized error/success messages
│   │   └── enums/                 # Shared enums (Role, AuthProvider, etc.)
│   ├── database/
│   │   ├── typeorm.config.ts      # TypeORM DataSource config (CLI migrations)
│   │   └── migrations/            # Database migration files
│   ├── health/                    # Health-check endpoint
│   ├── redis/                     # Redis caching service
│   └── modules/
│       ├── auth/                  # Authentication & OAuth
│       │   ├── dto/               # Data Transfer Objects
│       │   ├── guards/            # Auth guards (JWT, Roles)
│       │   ├── decorators/        # Custom decorators (@Roles)
│       │   └── strategies/        # Passport strategies
│       ├── users/                 # User management
│       └── groups/                # Group management & memberships
├── test/                          # E2E tests
├── docker-compose.yml             # Docker services configuration
├── Dockerfile                     # Docker image configuration
└── README.md                      # This file
```

---

## 🤝 Contributing

## Branch Naming Conventions

### Naming Rules

- Use lowercase with hyphens: `feature/add-user-authentication`
- Keep it short and descriptive (Max 3–5 words)
- Prefix with a category: `feature/`, `fix/`, `hotfix/`, etc.
- Avoid special characters, ambiguous names, or overly long names

### Branch Categories

| Prefix | Purpose | Example |
|--------|---------|---------|
| `feature/` | New features | `feature/add-search-filter` |
| `fix/` | Bug fixes | `fix/login-error-mobile` |
| `hotfix/` | Critical production fixes | `hotfix/critical-api-fix` |
| `chore/` | Maintenance tasks | `chore/update-dependencies` |
| `docs/` | Documentation updates | `docs/update-readme` |
| `refactor/` | Code refactoring | `refactor/simplify-auth-logic` |

## Commit Message Conventions

### Format

```
<type>(<optional scope>): <description>
```

### Rules

- Use imperative, present tense: "add" not "added" or "adds"
- Do not capitalize the first letter
- Do not end with a period
- Keep description concise (1-100 characters)

### Commit Types

| Type | Purpose | Example |
|------|---------|---------|
| `feat` | New feature or functionality | `feat(auth): add login endpoint` |
| `fix` | Bug fix | `fix(api): resolve null pointer error` |
| `refactor` | Code restructuring without behavior change | `refactor: simplify user service` |
| `perf` | Performance improvements | `perf: optimize database queries` |
| `style` | Code formatting (whitespace, semicolons) | `style: fix indentation` |
| `test` | Add or update tests | `test: add unit tests for auth` |
| `docs` | Documentation changes | `docs: update api documentation` |
| `build` | Build system or dependencies | `build: update nestjs to v10` |
| `ops` | Infrastructure, deployment, CI/CD | `ops: configure docker compose` |
| `chore` | Other changes (gitignore, configs) | `chore: init` |

### Pull Request Process

1. Create a feature branch from `main`
2. Make your changes with clear commit messages
3. Write or update tests as needed
4. Ensure all tests pass: `npm test`
5. Update documentation if needed
6. Submit a pull request to `main`
7. Request review from team members

---

## 🔗 Useful Links

- **API Documentation (Swagger)**: http://localhost:3000/api/docs
- **Health Check**: http://localhost:3000/health
- **GitHub Repository**: https://github.com/WDP301-SP26/BE-repo

---

## 🆘 Need Help?

- Check the [Troubleshooting](#troubleshooting) section
- Try the [API Testing](#api-testing) guide
- Open an issue on GitHub
- Contact the development team

---

## Chat APIs

### REST endpoints

- `POST /api/chat/conversations`
  - Get or create a 1-1 conversation for a valid `semester_id + class_id + student_id + lecturer_id` context.
  - Rules:
    - student must belong to the class
    - lecturer must teach the class
    - class must belong to the semester
    - caller must be either the student side or lecturer side of that conversation
- `GET /api/chat/conversations`
  - List current user's conversations
  - Returns `unread_count`, `last_message`, `last_message_at`, `last_message_preview`
- `GET /api/chat/conversations/:id/messages?cursor=&limit=`
  - Cursor pagination ordered by `created_at DESC`
- `POST /api/chat/conversations/:id/messages`
  - Send a message into a conversation you belong to
  - Supports optional `client_id` for idempotency
- `PATCH /api/chat/conversations/:id/read`
  - Mark all unread incoming messages in a conversation as read
- `PATCH /api/chat/messages/:id/read`
  - Backward-compatible read API, marks all unread incoming messages up to that message as read

### Conversation request shape

```json
{
  "semester_id": "11111111-1111-1111-1111-111111111111",
  "class_id": "22222222-2222-2222-2222-222222222222",
  "student_id": "33333333-3333-3333-3333-333333333333",
  "lecturer_id": "44444444-4444-4444-4444-444444444444"
}
```

### Send message request shape

```json
{
  "content": "Hello teacher, I have updated the report.",
  "type": "TEXT",
  "client_id": "mobile-msg-001"
}
```

### Message pagination response

```json
{
  "data": [
    {
      "id": "msg-1",
      "conversation_id": "conv-1",
      "sender_id": "student-1",
      "content": "Hello teacher",
      "type": "TEXT",
      "client_id": "mobile-msg-001",
      "read_by_recipient_at": null,
      "created_at": "2026-03-27T10:00:00.000Z",
      "updated_at": "2026-03-27T10:00:00.000Z"
    }
  ],
  "meta": {
    "next_cursor": "2026-03-27T09:55:00.000Z",
    "limit": 20,
    "has_more": true
  }
}
```

### Socket contract

Namespace: `/chat`

Handshake auth:
- JWT token via `auth.token`
- or `Authorization: Bearer <token>`
- or `query.token`

Client events:
- `chat:send`
- `chat:read`
- `chat:typing:start`
- `chat:typing:stop`

Server events:
- `chat:new`
- `chat:read`
- `chat:typing`
- `chat:error`

Event payload core fields:
- `conversation_id`
- `message_id`
- `sender_id`
- `content`
- `created_at`
- `client_id`

Read flow for mobile:
1. Call `GET /api/chat/conversations`
2. Open detail and call `GET /api/chat/conversations/:id/messages`
3. After rendering latest messages, call `PATCH /api/chat/conversations/:id/read`
4. Listen to `chat:read` to keep state in sync across devices

### Error code dictionary

- `CHAT_FORBIDDEN`
- `CHAT_INVALID_CONTEXT`
- `CHAT_INVALID_PAYLOAD`
- `CHAT_DUPLICATE_CLIENT_ID`
- `CHAT_NOT_FOUND`
- `CHAT_CLOSED`
- `CHAT_RATE_LIMITED`

### Mobile Owner quick integration notes

- Use REST for initial conversation list and history.
- Use socket `/chat` only for realtime updates.
- Use `client_id` per outbound message to avoid duplicate sends after retry.
- Use `PATCH /api/chat/conversations/:id/read` as the main read API.
- Do not assume the client can create arbitrary conversations; server validates semester/class/student/lecturer context strictly.

## Review Session attendance tracking & problem carryover

- ReviewSession now supports per-student ttendance_records plus derived ttendance_ratio.
- New sessions default to SCHEDULED.
- When a lecturer creates a new review session, unresolved 
ot-done problems from the latest previous session of the same group are carried forward automatically.
- Checkpoint auto scoring now includes attendance derived from ttendance_records when present; older sessions without that field remain backward-compatible via the stored ttendance_ratio.
- Review session edits/deletes are tracked through ReviewSessionAuditLog, and version history can be queried by group and milestone.
