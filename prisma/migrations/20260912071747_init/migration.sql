-- CreateEnum
CREATE TYPE "Role" AS ENUM ('LEAD_GENERATION', 'LEAD_GENERATION_SUPERVISOR', 'AGENT_SUPERVISOR', 'AGENT');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('WEBSITE', 'FACEBOOK', 'INSTAGRAM', 'WHATSAPP', 'GOOGLE_CAMPAIGN', 'PROPERTY_PORTAL', 'PHONE_CALL', 'MANUAL_ENTRY');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'LEAD_GENERATION_FOLLOW_UP', 'QUALIFIED', 'PENDING_AGENT_ASSIGNMENT', 'AGENT_ASSIGNED', 'CONVERTED_PENDING_APPROVAL', 'DROPPED_PENDING_APPROVAL', 'NOT_QUALIFIED', 'CLOSED');

-- CreateEnum
CREATE TYPE "PropertyType" AS ENUM ('APARTMENT', 'VILLA', 'TOWNHOUSE', 'OFFICE', 'RETAIL', 'LAND');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('HOT', 'WARM', 'COLD');

-- CreateEnum
CREATE TYPE "NotQualifiedReason" AS ENUM ('BUDGET_NOT_SUITABLE', 'PROPERTY_NOT_AVAILABLE', 'NOT_INTERESTED', 'DUPLICATE_LEAD', 'INVALID_CONTACT', 'FUTURE_REQUIREMENT', 'UNABLE_TO_CONTACT', 'OTHER');

-- CreateEnum
CREATE TYPE "DroppedReason" AS ENUM ('BUDGET_ISSUE', 'LOST_TO_COMPETITOR', 'CUSTOMER_UNRESPONSIVE', 'PROPERTY_UNAVAILABLE', 'OTHER');

-- CreateEnum
CREATE TYPE "LeadEventType" AS ENUM ('LEAD_CREATED', 'QUALIFICATION_STARTED', 'LEAD_QUALIFIED', 'PENDING_AGENT_ASSIGNMENT', 'LEAD_MARKED_NOT_QUALIFIED', 'AGENT_ASSIGNED', 'AGENT_REASSIGNED', 'LEAD_MARKED_CONVERTED', 'LEAD_MARKED_DROPPED', 'OUTCOME_APPROVED', 'LEAD_CLOSED');

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "whatsappNumber" TEXT,
    "email" TEXT,
    "source" "LeadSource" NOT NULL,
    "campaign" TEXT,
    "interestedLocation" TEXT,
    "propertyType" "PropertyType",
    "bedrooms" INTEGER,
    "budgetFrom" DECIMAL(12,2),
    "budgetTo" DECIMAL(12,2),
    "movingDate" DATE,
    "priority" "Priority",
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "assignedAgentId" INTEGER,
    "createdByUserId" INTEGER NOT NULL,
    "qualificationComment" TEXT,
    "notQualifiedReason" "NotQualifiedReason",
    "notQualifiedComment" TEXT,
    "convertedPropertyId" INTEGER,
    "convertedUnitId" INTEGER,
    "convertedComment" TEXT,
    "droppedReason" "DroppedReason",
    "droppedComment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadEvent" (
    "id" SERIAL NOT NULL,
    "leadId" INTEGER NOT NULL,
    "type" "LeadEventType" NOT NULL,
    "performedByUserId" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    "comment" TEXT,

    CONSTRAINT "LeadEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "Lead_status_idx" ON "Lead"("status");

-- CreateIndex
CREATE INDEX "Lead_assignedAgentId_idx" ON "Lead"("assignedAgentId");

-- CreateIndex
CREATE INDEX "Lead_phone_idx" ON "Lead"("phone");

-- CreateIndex
CREATE INDEX "Lead_whatsappNumber_idx" ON "Lead"("whatsappNumber");

-- CreateIndex
CREATE INDEX "Lead_email_idx" ON "Lead"("email");

-- CreateIndex
CREATE INDEX "Lead_createdAt_idx" ON "Lead"("createdAt");

-- CreateIndex
CREATE INDEX "LeadEvent_leadId_occurredAt_idx" ON "LeadEvent"("leadId", "occurredAt");

-- CreateIndex
CREATE INDEX "LeadEvent_type_idx" ON "LeadEvent"("type");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_assignedAgentId_fkey" FOREIGN KEY ("assignedAgentId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadEvent" ADD CONSTRAINT "LeadEvent_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadEvent" ADD CONSTRAINT "LeadEvent_performedByUserId_fkey" FOREIGN KEY ("performedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
