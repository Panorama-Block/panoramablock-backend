import { describe, expect, it } from "vitest";
import { entityConfigByCollection } from "../../../packages/core/entities.js";

describe("user-identities entity contract", () => {
  const config = entityConfigByCollection["user-identities"];

  it("registers UserIdentity with the expected tenant and key contract", () => {
    expect(config).toBeDefined();
    expect(config.model).toBe("UserIdentity");
    expect(config.primaryKeys).toEqual(["id"]);
    expect(config.tenantField).toBe("tenantId");
    expect(config.defaultOrderBy).toEqual({ createdAt: "desc" });
  });

  it("accepts a verified identity mapping", () => {
    const result = config.create.safeParse({
      userId: "user-1",
      provider: "telegram",
      providerSubject: "123456789",
      provenance: {
        source: "validated-legacy-link"
      },
      verifiedAt: "2026-09-25T19:00:00.000Z",
      tenantId: "panorama"
    });

    expect(result.success).toBe(true);
  });

  it("requires all identity coordinates and verification time", () => {
    const requiredFields = [
      "userId",
      "provider",
      "providerSubject",
      "verifiedAt",
      "tenantId"
    ];

    const valid = {
      userId: "user-1",
      provider: "telegram",
      providerSubject: "123456789",
      verifiedAt: "2026-09-25T19:00:00.000Z",
      tenantId: "panorama"
    };

    for (const field of requiredFields) {
      const candidate = { ...valid };
      delete candidate[field as keyof typeof candidate];

      expect(
        config.create.safeParse(candidate).success,
        `${field} must be required`
      ).toBe(false);
    }
  });

  it("rejects empty identity coordinates", () => {
    const result = config.create.safeParse({
      userId: "",
      provider: "",
      providerSubject: "",
      verifiedAt: "2026-09-25T19:00:00.000Z",
      tenantId: ""
    });

    expect(result.success).toBe(false);
  });

  it("does not permit generic updates to relink an identity", () => {
    const immutableFields = [
      "userId",
      "provider",
      "providerSubject",
      "tenantId"
    ];

    for (const field of immutableFields) {
      const result = config.update.safeParse({
        [field]: "replacement"
      });

      expect(result.success, `${field} must not be mutable`).toBe(false);
    }
  });

  it("permits provenance and verification metadata updates", () => {
    const result = config.update.safeParse({
      provenance: {
        source: "reconciled"
      },
      verifiedAt: "2026-09-25T20:00:00.000Z"
    });

    expect(result.success).toBe(true);
  });

  it("accepts the bounded resolver query shape", () => {
    const result = config.filter.safeParse({
      where: {
        provider: "telegram",
        providerSubject: "123456789"
      },
      take: 2
    });

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.take).toBe(2);
      expect(result.data.where).toEqual({
        provider: "telegram",
        providerSubject: "123456789"
      });
    }
  });
});
