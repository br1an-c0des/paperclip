import { describe, expect, it } from "vitest";
import { renderMarkdown } from "@/ui/Markdown";
import { clampImage, documentImages, imageLabel, stepImage } from "./gallery-model";

describe("the document gallery", () => {
  it("finds the rendered images in reading order, repeated and reference ones included", () => {
    const root = document.createElement("div");
    root.innerHTML = renderMarkdown(
      ["![First](/a.png)", "", "Some text ![Second][ref] and ![First](/a.png) again.", "", "[ref]: /b.png", "", "<img alt='no source'>"].join("\n"),
    );
    expect(documentImages(root).map((entry) => entry.image)).toEqual([
      { src: "/a.png", alt: "First" },
      { src: "/b.png", alt: "Second" },
      { src: "/a.png", alt: "First" },
    ]);
  });

  it("steps round at either end", () => {
    expect(stepImage(3, 1, 3)).toBe(1);
    expect(stepImage(1, -1, 3)).toBe(3);
    expect(stepImage(2, 1, 3)).toBe(3);
    expect(stepImage(1, 1, 0)).toBeNull();
  });

  it("opens a link's position only when there's an image there", () => {
    expect(clampImage(2, 3)).toBe(2);
    expect(clampImage(4, 3)).toBeNull();
    expect(clampImage(null, 3)).toBeNull();
    expect(imageLabel(2, 5, "Chart")).toBe("Image 2 of 5: Chart");
    expect(imageLabel(1, 1)).toBe("Image 1 of 1");
  });
});
