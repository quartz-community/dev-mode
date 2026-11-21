import crypto from "node:crypto";
import { test, expect } from "../../helpers/repro-fixture";

// quartz-community/encrypted-pages#2: a note is encrypted in the transformer phase, before
// render-time content is filled in: bases (page types' treeTransforms) and transclusions
// (renderTranscludes). What gets encrypted is the empty placeholder.
//
// Expected: the decrypted page holds what the unencrypted page shows: the base's table and the
// transcluded note's text.

function decrypt(base64: string, password: string, iterations: number): string {
  const buffer = Buffer.from(base64, "base64");
  const salt = buffer.subarray(0, 16);
  const iv = buffer.subarray(16, 28);
  const tag = buffer.subarray(28, 44);
  const key = crypto.pbkdf2Sync(password, salt, iterations, 32, "sha256");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return (
    decipher.update(buffer.subarray(44), undefined, "utf8") +
    decipher.final("utf8")
  );
}

test.describe("quartz-community/encrypted-pages#2 encrypted pages hold their render-time content", () => {
  test("control: the unencrypted page shows the base and the transclusion", async ({
    page,
    site,
    pageProblems,
  }) => {
    await page.goto(site.url("/"));
    await expect(page.locator("article .bases-table tbody tr")).toHaveCount(2);
    await expect(page.locator("article")).toContainText(
      "The transcluded snippet text.",
    );
    expect(pageProblems.all()).toEqual([]);
  });

  test("control: the locked page is encrypted, and nothing shows in the clear", async ({
    page,
    site,
  }) => {
    await page.goto(site.url("locked"));
    await expect(
      page.locator(".encrypted-page[data-encrypted]"),
    ).toBeAttached();
    const article = (await page.locator("article").innerHTML()).replace(
      /data-encrypted="[^"]*"/,
      "",
    );
    expect(article).not.toContain("Locked intro.");
    expect(article).not.toContain("bases-table");
    expect(article).not.toContain("transcluded snippet");
  });

  test("the decrypted page holds the base's table and the transcluded text", async ({
    page,
    site,
  }) => {
    await page.goto(site.url("locked"));
    const container = page.locator(".encrypted-page[data-encrypted]").first();
    const payload = (await container.getAttribute("data-encrypted"))!;
    const iterations = Number(await container.getAttribute("data-iterations"));
    const plain = decrypt(payload, "secret", iterations);
    expect(plain).toContain("Locked intro.");
    expect(plain).toContain("bases-table");
    expect(plain).toContain("Animal Farm");
    expect(plain).toContain("The transcluded snippet text.");
  });
});
