# Technical Coding Assignment — Lead Management API

## Overview

As part of our technical evaluation, we would like you to build a small backend service for a **Real Estate Lead Management System**.

The purpose of this assignment is to evaluate your approach to:

- Backend architecture and code organization
- REST API design
- Database modeling
- Business rules and workflow management
- Role-based access control
- Audit/history tracking
- Testing
- Documentation and engineering decision-making

This is intentionally a **limited-scope exercise**.

**Expected effort: Maximum 48 hours.**

We do not expect a production-complete application. If you cannot complete a feature within the available time, document what remains and how you would approach it.

We value a **simple, well-designed and maintainable solution** over an over-engineered one.

---

## Technology Requirements

Please use:

- Node.js
- TypeScript
- PostgreSQL
- REST API

You are free to choose the framework and supporting libraries you consider appropriate.

Examples include:

- NestJS
- Express
- Fastify
- Prisma
- TypeORM
- Drizzle

Please briefly explain your major technology choices in the README.

A modular monolith is completely acceptable. Microservices are **not required**.

---

# Business Scenario

The system receives leads from different sources such as:

- Website
- Facebook
- Instagram
- WhatsApp
- Google Campaigns
- Property Portals
- Phone Calls
- Manual Entry

A lead progresses through qualification, assignment to a real-estate agent, agent follow-up and eventually conversion or dropping.

For this assignment, implement the simplified workflow below:

```text
NEW
 ↓
LEAD_GENERATION_FOLLOW_UP
 ↓
QUALIFIED
 ↓
PENDING_AGENT_ASSIGNMENT
 ↓
AGENT_ASSIGNED
 ↓
CONVERTED_PENDING_APPROVAL
       OR
DROPPED_PENDING_APPROVAL
 ↓
CLOSED
```

Not every transition is valid.

For example:

```text
NEW → AGENT_ASSIGNED       ❌
NEW → CLOSED               ❌
QUALIFIED → CLOSED         ❌
AGENT_ASSIGNED → CLOSED    ❌
```

The API should reject invalid state transitions.

---

# 1. Users and Roles

Support the following roles:

```text
LEAD_GENERATION
LEAD_GENERATION_SUPERVISOR
AGENT_SUPERVISOR
AGENT
```

Authentication can be kept simple.

JWT authentication with seeded users is sufficient.

Authorization, however, must be enforced by the backend.

For example:

- Lead Generation users can create and qualify leads.
- Agent Supervisors can assign qualified leads to agents.
- Agents can access leads assigned to them.
- An Agent must not be able to access another Agent's assigned lead.

You may make reasonable assumptions regarding permissions. Document these assumptions in the README.

---

# 2. Lead Creation

Implement an API to create a lead.

For example:

```http
POST /leads
```

Example request:

```json
{
  "name": "Ahmed Ali",
  "phone": "+97455555555",
  "whatsappNumber": "+97455555555",
  "email": "ahmed@example.com",
  "source": "FACEBOOK",
  "campaign": "West Bay Apartments",
  "interestedLocation": "West Bay",
  "propertyType": "APARTMENT",
  "bedrooms": 2,
  "budgetFrom": 6000,
  "budgetTo": 8000,
  "movingDate": "2026-10-01",
  "priority": "HOT"
}
```

The original lead source should remain associated with the lead throughout its lifecycle.

---

# 3. Duplicate Lead Detection

When creating a lead, check for possible existing leads using:

- Phone number
- WhatsApp number
- Email address

If a possible duplicate exists, the API should indicate this.

For example:

```json
{
  "warning": "POSSIBLE_DUPLICATE",
  "existingLeadIds": [123]
}
```

Do **not** automatically merge duplicate leads.

The caller should be able to explicitly continue creating the new lead.

You may design the exact API behaviour for this requirement.

---

# 4. Lead Qualification

A Lead Generation user should be able to qualify a lead.

For example:

```http
POST /leads/:id/qualify
```

Example:

```json
{
  "qualificationComment": "Customer requires a 2-bedroom apartment in West Bay",
  "interestedLocation": "West Bay",
  "budgetFrom": 6000,
  "budgetTo": 8000
}
```

A successfully qualified lead should eventually enter:

```text
PENDING_AGENT_ASSIGNMENT
```

Also support marking a lead as **Not Qualified**.

A reason should be required.

Possible reasons could include:

```text
BUDGET_NOT_SUITABLE
PROPERTY_NOT_AVAILABLE
NOT_INTERESTED
DUPLICATE_LEAD
INVALID_CONTACT
FUTURE_REQUIREMENT
UNABLE_TO_CONTACT
OTHER
```

A comment may optionally be provided.

---

# 5. Agent Assignment

A qualified lead waiting for assignment can be assigned by an:

```text
AGENT_SUPERVISOR
```

For example:

```http
POST /leads/:id/assign
```

Request:

```json
{
  "agentId": 42
}
```

The operation should:

1. Assign the Agent.
2. Change the lead status appropriately.
3. Record who performed the assignment.
4. Record when the assignment occurred.

---

# 6. Agent Outcome

The assigned Agent should be able to mark the lead as either:

```text
CONVERTED_PENDING_APPROVAL
```

or:

```text
DROPPED_PENDING_APPROVAL
```

### Converted

Example:

```http
POST /leads/:id/convert
```

```json
{
  "propertyId": 123,
  "unitId": 456,
  "comment": "Customer agreed to proceed with the property"
}
```

### Dropped

Example:

```http
POST /leads/:id/drop
```

```json
{
  "reason": "BUDGET_ISSUE",
  "comment": "Customer cannot increase the budget"
}
```

Only the Agent assigned to the lead should be allowed to perform these actions.

---

# 7. Approval

A:

```text
LEAD_GENERATION_SUPERVISOR
```

should be able to approve a pending outcome.

For this assignment, you may use the simplified transitions:

```text
CONVERTED_PENDING_APPROVAL
            ↓
          CLOSED
```

and:

```text
DROPPED_PENDING_APPROVAL
            ↓
          CLOSED
```

The system should retain the complete history after the lead is closed.

---

# 8. Lead Timeline / Audit History

Every important operation should automatically create a timeline/audit entry.

Examples include:

```text
Lead Created
Qualification Started
Lead Qualified
Lead Marked Not Qualified
Agent Assigned
Lead Marked Converted
Lead Marked Dropped
Outcome Approved
Lead Closed
```

An event should contain enough information to determine:

- What happened
- Who performed the action
- When it happened
- Relevant information about the action

Example:

```json
{
  "type": "AGENT_ASSIGNED",
  "performedBy": 12,
  "timestamp": "2026-09-10T11:00:00Z",
  "metadata": {
    "agentId": 42
  }
}
```

Provide an endpoint such as:

```http
GET /leads/:id/timeline
```

which returns the lead's history chronologically.

The timeline/history should not disappear when a lead reaches `CLOSED`.

---

# 9. Lead Retrieval

Provide suitable endpoints for retrieving leads.

At minimum:

```http
GET /leads
GET /leads/:id
```

Access must respect the logged-in user's role.

For example, an Agent should only be able to retrieve leads assigned to them.

You may implement pagination and filtering if time permits.

---

# 10. Testing

Include automated tests for the important business rules.

At minimum, we would like to see tests covering scenarios such as:

- Successful lead qualification
- Agent assignment
- Invalid workflow transition
- Agent attempting to access another Agent's lead
- Duplicate lead detection
- Timeline/audit event creation

You do not need to target a specific code coverage percentage.

We are more interested in **what you choose to test and why**.

---

# Out of Scope

You do **not** need to implement:

- Frontend/UI
- Zoom Contact Center integration
- Facebook/Instagram integration
- WhatsApp integration
- Email integration
- Notifications
- Dashboards or analytics
- Property recommendation algorithms
- Automatic Agent assignment
- AI lead scoring
- Redis
- RabbitMQ
- Kubernetes
- Microservices

Please focus on the core backend design and business rules.

---

# Deliverables

Please provide a Git repository containing your implementation.

The repository should include:

### Source Code

The application source code and database migrations.

### README

Include:

- How to run the application
- Architecture overview
- Database/schema explanation
- API overview
- Authentication instructions / test users
- Assumptions you made
- Important technical decisions
- Trade-offs made because of the 48-hour time limit
- What you would improve/change for a production implementation

### Database

Please provide:

- Database migrations
- Seed data where useful

### API Documentation

Provide at least one of:

- OpenAPI / Swagger
- Postman collection
- Bruno collection
- Insomnia collection

### Tests

Include the automated tests you consider important.

### Docker

Preferably, we should be able to start the application and PostgreSQL using:

```bash
docker compose up
```

If you choose another setup approach, clearly document it.

---

# Git Usage

Please use Git normally while developing the solution.

We prefer to see meaningful commits representing the progression of your implementation rather than a single final commit containing the entire solution.

---

# Evaluation Criteria

We will primarily evaluate:

| Area | Weight |
|---|---:|
| Architecture and code organization | 20% |
| Database/data modeling | 20% |
| Workflow and business rules | 20% |
| Authorization and security | 15% |
| Code quality and maintainability | 10% |
| Automated testing | 10% |
| Documentation and technical decisions | 5% |

Completing every optional feature is **not required**.

A smaller implementation with good architecture, clear reasoning and correct business rules will be evaluated more positively than a larger but unnecessarily complex implementation.

---

# Time Limit

**Please spend no more than 48 hours on this assignment.**

We intentionally expect you to make decisions about what to prioritize within that time.

If something cannot reasonably be completed, document:

1. What remains.
2. How you would implement it.
3. Any architectural considerations involved.

Please do not spend additional time simply to make the submission appear more complete.

Good luck, and we look forward to reviewing your solution.
