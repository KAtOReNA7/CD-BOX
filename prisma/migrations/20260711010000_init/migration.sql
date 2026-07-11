-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ReleaseCategory" AS ENUM ('ORIGINAL_ALBUM', 'SINGLE', 'BEST', 'COLLECTION', 'COMPILATION', 'LIVE', 'REMIX', 'BOX', 'EP', 'OTHER');

-- CreateEnum
CREATE TYPE "CollectionStatus" AS ENUM ('WANTED', 'OWNED', 'NOT_OWNED', 'EXCLUDED', 'PENDING_REVIEW');

-- CreateEnum
CREATE TYPE "ReleaseFormat" AS ENUM ('CD', 'SHM_CD', 'BLU_SPEC_CD', 'SACD', 'HYBRID_SACD', 'CD_DVD', 'BOX_SET', 'OTHER');

-- CreateEnum
CREATE TYPE "ImportBatchStatus" AS ENUM ('DRAFT', 'IMPORTED', 'FAILED');

-- CreateEnum
CREATE TYPE "AiSearchTaskStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "UiAssetKind" AS ENUM ('EMPTY_STATE', 'DECORATION', 'PLACEHOLDER');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "Artist" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortName" TEXT,
    "country" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Artist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserArtistFollow" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserArtistFollow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Release" (
    "id" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "category" "ReleaseCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "originalReleaseDate" TIMESTAMP(3),
    "format" "ReleaseFormat" NOT NULL DEFAULT 'CD',
    "originalCatalogNo" TEXT,
    "label" TEXT,
    "originalPrice" TEXT,
    "editionType" TEXT,
    "isReissue" BOOLEAN NOT NULL DEFAULT false,
    "isRemaster" BOOLEAN NOT NULL DEFAULT false,
    "isExcludedByDefault" BOOLEAN NOT NULL DEFAULT false,
    "confidence" TEXT,
    "warnings" JSONB,
    "notes" TEXT,
    "coverImageUrl" TEXT,
    "importBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Release_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReleaseSource" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "label" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReleaseSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserReleaseStatus" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "status" "CollectionStatus" NOT NULL DEFAULT 'NOT_OWNED',
    "priority" INTEGER NOT NULL DEFAULT 3,
    "ownedCondition" TEXT,
    "ownedNotes" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserReleaseStatus_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "UserReleaseStatus_priority_check" CHECK ("priority" BETWEEN 1 AND 5)
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "artistId" TEXT,
    "fileName" TEXT,
    "sourceType" TEXT NOT NULL DEFAULT 'excel',
    "status" "ImportBatchStatus" NOT NULL DEFAULT 'DRAFT',
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "errorJson" JSONB,
    "importedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiSearchTask" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "artistId" TEXT,
    "query" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" "AiSearchTaskStatus" NOT NULL DEFAULT 'QUEUED',
    "rawResult" JSONB,
    "parsedResult" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiSearchTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UiAsset" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "kind" "UiAssetKind" NOT NULL,
    "prompt" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "imageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UiAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE INDEX "Artist_name_idx" ON "Artist"("name");

-- CreateIndex
CREATE INDEX "UserArtistFollow_artistId_idx" ON "UserArtistFollow"("artistId");

-- CreateIndex
CREATE UNIQUE INDEX "UserArtistFollow_userId_artistId_key" ON "UserArtistFollow"("userId", "artistId");

-- CreateIndex
CREATE INDEX "Release_artistId_category_idx" ON "Release"("artistId", "category");

-- CreateIndex
CREATE INDEX "Release_importBatchId_idx" ON "Release"("importBatchId");

-- CreateIndex
CREATE INDEX "Release_title_idx" ON "Release"("title");

-- CreateIndex
CREATE INDEX "ReleaseSource_releaseId_idx" ON "ReleaseSource"("releaseId");

-- CreateIndex
CREATE INDEX "UserReleaseStatus_userId_status_idx" ON "UserReleaseStatus"("userId", "status");

-- CreateIndex
CREATE INDEX "UserReleaseStatus_releaseId_idx" ON "UserReleaseStatus"("releaseId");

-- CreateIndex
CREATE UNIQUE INDEX "UserReleaseStatus_userId_releaseId_key" ON "UserReleaseStatus"("userId", "releaseId");

-- CreateIndex
CREATE INDEX "ImportBatch_userId_idx" ON "ImportBatch"("userId");

-- CreateIndex
CREATE INDEX "ImportBatch_artistId_idx" ON "ImportBatch"("artistId");

-- CreateIndex
CREATE INDEX "AiSearchTask_userId_idx" ON "AiSearchTask"("userId");

-- CreateIndex
CREATE INDEX "AiSearchTask_artistId_idx" ON "AiSearchTask"("artistId");

-- CreateIndex
CREATE INDEX "UiAsset_userId_idx" ON "UiAsset"("userId");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserArtistFollow" ADD CONSTRAINT "UserArtistFollow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserArtistFollow" ADD CONSTRAINT "UserArtistFollow_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Release" ADD CONSTRAINT "Release_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Release" ADD CONSTRAINT "Release_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseSource" ADD CONSTRAINT "ReleaseSource_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "Release"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserReleaseStatus" ADD CONSTRAINT "UserReleaseStatus_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserReleaseStatus" ADD CONSTRAINT "UserReleaseStatus_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "Release"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSearchTask" ADD CONSTRAINT "AiSearchTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSearchTask" ADD CONSTRAINT "AiSearchTask_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UiAsset" ADD CONSTRAINT "UiAsset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
