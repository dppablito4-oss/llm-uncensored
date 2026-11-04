import { describe, it, expect } from "vitest";
import { envelopeAnswer, parseEnvelope } from "../shared/envelope";
describe("Separación segura de respuesta y memoria", () => {
  it("transmite solo answer con cualquier corte, escapes, Unicode y Markdown", () => {
    const answer = '**Hola**\n"texto" \\ 🦊 *cursiva*';
    const raw = JSON.stringify({ answer, summary: "MEMORIA PRIVADA" });
    let previous = "";
    for (let i = 0; i <= raw.length; i++) {
      const visible = envelopeAnswer(raw.slice(0, i));
      expect(answer.startsWith(visible)).toBe(true);
      expect(visible.startsWith(previous)).toBe(true);
      expect(visible).not.toContain("MEMORIA");
      previous = visible;
    }
    expect(previous).toBe(answer);
    expect(parseEnvelope(raw).summary).toBe("MEMORIA PRIVADA");
  });
  it("no muestra una memoria que llega primero, ni JSON incompleto", () => {
    const raw = JSON.stringify({ summary: "PRIVATE", answer: "Respuesta" });
    expect(envelopeAnswer(raw)).toBe("Respuesta");
    expect(envelopeAnswer('{"summary":"PRIVATE')).toBe("");
    expect(() => parseEnvelope('{"answer":"hola')).toThrow("SUMMARY_FORMAT");
    expect(
      envelopeAnswer('```json\n{"answer":"hola","summary":"oculto"}\n```'),
    ).toBe("hola");
  });
});
