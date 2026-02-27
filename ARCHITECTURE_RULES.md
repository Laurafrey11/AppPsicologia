# Architecture Rules

Stack:
- Next.js (App Router)
- TypeScript
- Zod
- Vitest

Rules:

1. Frontend never talks directly to DB.
2. All requests go through API routes.
3. Controllers validate input and call services.
4. Services contain ALL business logic.
5. Repositories handle data access only.
6. Services are testable and independent of UI.
7. No business logic inside API routes.
8. Atomic operations required for critical resources.
9. No console.log in production code.
10. Tests required for every service.
