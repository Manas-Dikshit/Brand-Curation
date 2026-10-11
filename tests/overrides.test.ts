import ExcelJS from "exceljs";
import { expect, test } from "vitest";
import { normalizeBrands, parseBrandWorkbook } from "@/lib/overrides";

async function makeXlsx(rows: unknown[][]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  rows.forEach(r => ws.addRow(r));
  const buf = await wb.xlsx.writeBuffer();
  return buf as unknown as ArrayBuffer;
}

test("normalizeBrands never throws and only admits well-formed strings", () => {
  expect(normalizeBrands(null)).toEqual([]);
  expect(normalizeBrands("nope")).toEqual([]);
  expect(normalizeBrands([{ brand: 123 }])).toEqual([]);
  expect(normalizeBrands([null, { brand: "" }, { brand: "   " }])).toEqual([]);
  expect(normalizeBrands([{ brand: " Acme ", website: "https://acme.com", instagram: 7 }]))
    .toEqual([{ brand: "Acme", website: "https://acme.com", instagram: null }]);
  expect(normalizeBrands([{ brand: "x".repeat(300) }])[0].brand).toHaveLength(200);
});

test("parseBrandWorkbook keeps a first data row that merely starts with 'brand'", async () => {
  const { brands } = await parseBrandWorkbook(await makeXlsx([
    ["Brand", "Website"],
    ["Acme", "https://acme.com"],
    ["Brandy Co", null],
  ]));
  expect(brands.map(b => b.brand)).toEqual(["Acme", "Brandy Co"]);
});

test("parseBrandWorkbook works with no header row at all", async () => {
  const { brands } = await parseBrandWorkbook(await makeXlsx([
    ["Brandy Co", "https://brandy.co"],
    ["  Acme  ", null],
  ]));
  expect(brands.map(b => b.brand)).toEqual(["Brandy Co", "Acme"]);
});

test("parseBrandWorkbook collapses case/whitespace duplicates and reports them", async () => {
  const { brands, duplicates } = await parseBrandWorkbook(await makeXlsx([
    ["Brand", "Website"],
    ["Acme", null],
    ["  a c m e ", null],
  ]));
  expect(brands).toHaveLength(1);
  expect(duplicates).toHaveLength(1);
});