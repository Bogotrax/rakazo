import { describe, expect, it, vi } from "vitest";
import { createBotReaderRepos } from "./bot-readers.js";
import type { PrismaClient } from "./client.js";
import { currentDbContext } from "./row-security.js";

const actor = {
  userId: "reader",
  spaceId: "shared-space",
  email: "reader@example.test",
  isDeploymentOwner: false,
};

function fixture() {
  const prisma = {
    spaceMember: { findUnique: vi.fn().mockResolvedValue({ userId: actor.userId }) },
    botReader: { findMany: vi.fn().mockResolvedValue([{ botId: "shared-bot", role: "reader" }]) },
    bot: {
      findMany: vi.fn().mockResolvedValue([{ id: "shared-bot", name: "Shared" }]),
      findFirst: vi.fn().mockResolvedValue({
        id: "shared-bot",
        name: "Shared",
        userId: "owner",
        thread: { id: "thread" },
      }),
    },
    message: {
      findMany: vi.fn(async () => {
        expect(currentDbContext()).toEqual({
          kind: "tenant",
          spaceId: actor.spaceId,
          userId: "owner",
        });
        return [
          {
            id: "message",
            seq: 1,
            role: "bot",
            createdAt: new Date(0),
            blocks: [
              { kind: "text", text: "Visible" },
              { kind: "tool_call", text: "Private tool payload" },
              { kind: "file", url: "/private-file" },
            ],
          },
        ];
      }),
    },
  };
  return { prisma, repos: createBotReaderRepos(prisma as unknown as PrismaClient) };
}

describe("explicit bot read grants", () => {
  it("requires current Space membership even when a grant exists", async () => {
    const { prisma, repos } = fixture();
    prisma.spaceMember.findUnique.mockResolvedValue(null as never);
    await expect(repos.messages(actor, "shared-bot")).rejects.toThrow("Resource not found");
    expect(prisma.message.findMany).not.toHaveBeenCalled();
  });

  it("rejects ungranted bots and revoked grants", async () => {
    const { prisma, repos } = fixture();
    await expect(repos.messages(actor, "private-bot")).rejects.toThrow("Resource not found");
    prisma.botReader.findMany.mockResolvedValue([]);
    await expect(repos.messages(actor, "shared-bot")).rejects.toThrow("Resource not found");
    expect(prisma.bot.findFirst).not.toHaveBeenCalled();
  });

  it("limits bot resolution to the chosen Space and excludes archived and owned bots", async () => {
    const { prisma, repos } = fixture();
    await repos.list(actor);
    expect(prisma.bot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          spaceId: actor.spaceId,
          archivedAt: null,
          userId: { not: actor.userId },
          id: { in: ["shared-bot"] },
        },
      }),
    );
    prisma.bot.findFirst.mockResolvedValue(null as never);
    await expect(repos.messages(actor, "shared-bot")).rejects.toThrow("Resource not found");
    expect(prisma.message.findMany).not.toHaveBeenCalled();
  });

  it("returns conversation text only, using a fixed owner read scope and bounded pagination", async () => {
    const { prisma, repos } = fixture();
    const result = await repos.messages(actor, "shared-bot", 50);
    expect(result.messages[0]?.text).toBe("Visible");
    expect(JSON.stringify(result)).not.toContain("private-file");
    expect(JSON.stringify(result)).not.toContain("Private tool payload");
    expect(prisma.message.findMany).toHaveBeenCalledWith({
      where: {
        threadId: "thread",
        role: { in: ["user", "bot"] },
        seq: { lt: 50 },
      },
      orderBy: { seq: "desc" },
      take: 101,
    });
    expect(currentDbContext()).toBeUndefined();
    expect(Object.keys(repos).sort()).toEqual(["list", "messages", "sendTarget"]);
  });

  it("exposes the shared bot's role alongside its name", async () => {
    const { repos } = fixture();
    const list = await repos.list(actor);
    expect(list).toEqual([{ id: "shared-bot", name: "Shared", role: "reader" }]);
  });

  it("lets only participants send, resolving the owner for the turn", async () => {
    const { prisma, repos } = fixture();
    await expect(repos.sendTarget(actor, "shared-bot")).rejects.toThrow("Resource not found");
    prisma.botReader.findMany.mockResolvedValue([{ botId: "shared-bot", role: "participant" }]);
    const target = await repos.sendTarget(actor, "shared-bot");
    expect(target).toEqual({ botId: "shared-bot", threadId: "thread", ownerId: "owner" });
    await expect(repos.sendTarget(actor, "other-bot")).rejects.toThrow("Resource not found");
    prisma.spaceMember.findUnique.mockResolvedValue(null as never);
    await expect(repos.sendTarget(actor, "shared-bot")).rejects.toThrow("Resource not found");
  });

  it("paginates without dropping the oldest visible message", async () => {
    const { prisma, repos } = fixture();
    prisma.message.findMany.mockResolvedValue(
      Array.from({ length: 101 }, (_, index) => ({
        id: `message-${101 - index}`,
        seq: 101 - index,
        role: "bot",
        createdAt: new Date(0),
        blocks: [{ kind: "text", text: "Visible" }],
      })),
    );
    const page = await repos.messages(actor, "shared-bot");
    expect(page.messages).toHaveLength(100);
    expect(page.messages[0]?.seq).toBe(2);
    expect(page.messages[99]?.seq).toBe(101);
    expect(page.nextBefore).toBe(2);
  });

  it("rechecks membership and grants for each refresh", async () => {
    const { prisma, repos } = fixture();
    await repos.messages(actor, "shared-bot");
    prisma.spaceMember.findUnique.mockResolvedValue(null as never);
    await expect(repos.messages(actor, "shared-bot")).rejects.toThrow("Resource not found");
    expect(prisma.message.findMany).toHaveBeenCalledTimes(1);
  });
});
