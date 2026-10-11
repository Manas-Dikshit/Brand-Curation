import { expect, test } from "vitest";
import { registrable } from "@/lib/util/fetch";
import { withDemoFetch } from "@/lib/demo";

test("same-domain redirect guard treats co.in/co.uk as part of the public suffix", () => {
  expect(registrable("https://www.example.co.in/x")).toBe("example.co.in");
  expect(registrable("https://evil.co.in/x")).toBe("evil.co.in");
  expect(registrable("https://shop.example.com/x")).toBe("example.com");
});

test("withDemoFetch zeroes pacing for the demo and restores it afterwards", async () => {
  const prevPer = process.env.PER_DOMAIN_GAP_MS;
  const prevGlobal = process.env.GLOBAL_REQUEST_GAP_MS;
  let insidePer: string | undefined;
  let insideGlobal: string | undefined;

  await withDemoFetch(async () => {
    insidePer = process.env.PER_DOMAIN_GAP_MS;
    insideGlobal = process.env.GLOBAL_REQUEST_GAP_MS;
  });

  expect(insidePer).toBe("0");
  expect(insideGlobal).toBe("0");
  expect(process.env.PER_DOMAIN_GAP_MS).toBe(prevPer);
  expect(process.env.GLOBAL_REQUEST_GAP_MS).toBe(prevGlobal);
});