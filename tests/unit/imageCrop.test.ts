import { describe, it, expect, vi, beforeEach } from "vitest";

function createMockImage(options?: { loadImmediately?: boolean }) {
  const callbacks: Record<string, ((...args: unknown[]) => void) | null> = {};
  const loadImmediately = options?.loadImmediately ?? true;

  const mockImage = {
    addEventListener: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      callbacks[event] = handler;
    }),
    removeEventListener: vi.fn(),
    setAttribute: vi.fn(),
    src: "",
    naturalWidth: 100,
    naturalHeight: 100,
  };

  if (loadImmediately && callbacks.load) {
    callbacks.load();
  }

  return { mockImage, callbacks };
}

/**
 * Mock Image constructor — must be a proper constructor function.
 */
function MockImage(this: Record<string, unknown>) {
  const img = createMockImage().mockImage;
  Object.assign(this, img);
}

const createImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", (error) => reject(error));
    image.setAttribute("crossOrigin", "anonymous");
    image.src = url;
  });

async function getCroppedImg(
  imageSrc: string,
  pixelCrop: { x: number; y: number; width: number; height: number },
): Promise<string | null> {
  const image = await createImage(imageSrc);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  if (!ctx) return null;

  canvas.width = pixelCrop.width;
  canvas.height = pixelCrop.height;

  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    pixelCrop.width,
    pixelCrop.height,
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob((file) => {
      if (file) {
        resolve(URL.createObjectURL(file));
      } else {
        reject(new Error("Canvas is empty"));
      }
    }, "image/jpeg");
  });
}

describe("createImage", () => {
  it("resolves with the image element on successful load", async () => {
    let capturedImage: Record<string, unknown> | null = null;
    let loadHandler: (() => void) | null = null;

    function TestImage(this: Record<string, unknown>) {
      const self = this;
      capturedImage = self;
      self.addEventListener = vi.fn((event: string, handler: () => void) => {
        if (event === "load") loadHandler = handler;
      });
      self.setAttribute = vi.fn();
      self.src = "";
    }

    vi.stubGlobal("Image", TestImage as unknown as typeof Image);

    const promise = createImage("https://example.com/img.jpg");

    expect(capturedImage?.src).toBe("https://example.com/img.jpg");
    expect(capturedImage?.setAttribute).toHaveBeenCalledWith("crossOrigin", "anonymous");

    loadHandler?.();

    const result = await promise;
    expect(result).toBe(capturedImage);
  });

  it("rejects on image load error", async () => {
    let errorHandler: ((error: Event) => void) | null = null;

    function ErrorImage(this: Record<string, unknown>) {
      const self = this as Record<string, unknown>;
      self.addEventListener = vi.fn((event: string, handler: (e: Event) => void) => {
        if (event === "error") errorHandler = handler;
      });
      self.setAttribute = vi.fn();
      self.src = "";
    }

    vi.stubGlobal("Image", ErrorImage as unknown as typeof Image);

    const promise = createImage("https://example.com/bad.jpg");

    errorHandler?.(new Event("error"));

    await expect(promise).rejects.toBeDefined();
  });
});

describe("getCroppedImg", () => {
  let mockCanvas: HTMLCanvasElement;
  let mockCtx: CanvasRenderingContext2D;
  const mockBlobUrl = "blob:http://localhost/uuid";

  beforeEach(() => {
    mockCtx = { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;

    mockCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => mockCtx),
      toBlob: vi.fn((callback: BlobCallback) => {
        callback(new Blob(["fake-image-data"], { type: "image/jpeg" }));
      }),
    } as unknown as HTMLCanvasElement;

    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => mockBlobUrl),
    });

    function TestImage(this: Record<string, unknown>) {
      const self = this as Record<string, unknown>;
      let loadHandler: () => void;
      self.addEventListener = vi.fn((event: string, handler: () => void) => {
        if (event === "load") loadHandler = handler;
      });
      self.setAttribute = vi.fn();
      self.src = "";
      self.naturalWidth = 800;
      self.naturalHeight = 600;
      setTimeout(() => loadHandler?.(), 0);
    }

    vi.stubGlobal("Image", TestImage as unknown as typeof Image);

    vi.stubGlobal("document", {
      createElement: vi.fn((tag: string) => {
        if (tag === "canvas") return mockCanvas;
        return {};
      }),
    });
  });

  it("returns a blob URL when crop succeeds", async () => {
    const result = await getCroppedImg("https://example.com/img.jpg", {
      x: 10,
      y: 20,
      width: 100,
      height: 150,
    });

    expect(result).toBe(mockBlobUrl);
    expect(mockCanvas.width).toBe(100);
    expect(mockCanvas.height).toBe(150);
    expect(mockCtx.drawImage).toHaveBeenCalledWith(
      expect.anything(),
      10, 20, 100, 150,
      0, 0, 100, 150,
    );
  });

  it("returns null when canvas context is unavailable", async () => {
    const canvasNoCtx = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => null),
      toBlob: vi.fn(),
    } as unknown as HTMLCanvasElement;

    vi.stubGlobal("document", {
      createElement: vi.fn((tag: string) => {
        if (tag === "canvas") return canvasNoCtx;
        return {};
      }),
    });

    const result = await getCroppedImg("https://example.com/img.jpg", {
      x: 0, y: 0, width: 50, height: 50,
    });

    expect(result).toBeNull();
  });

  it("rejects when canvas.toBlob returns null (tainted canvas)", async () => {
    const taintedCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => mockCtx),
      toBlob: vi.fn((callback: BlobCallback) => {
        callback(null);
      }),
    } as unknown as HTMLCanvasElement;

    vi.stubGlobal("document", {
      createElement: vi.fn((tag: string) => {
        if (tag === "canvas") return taintedCanvas;
        return {};
      }),
    });

    await expect(
      getCroppedImg("https://example.com/img.jpg", { x: 0, y: 0, width: 50, height: 50 }),
    ).rejects.toThrow("Canvas is empty");
  });

  it("handles zero-dimension crop", async () => {
    const result = await getCroppedImg("https://example.com/img.jpg", {
      x: 0, y: 0, width: 0, height: 0,
    });
    expect(result).toBe(mockBlobUrl);
  });

  it("handles crop larger than source image", async () => {
    const result = await getCroppedImg("https://example.com/img.jpg", {
      x: 0, y: 0, width: 2000, height: 2000,
    });
    expect(result).toBe(mockBlobUrl);
    expect(mockCanvas.width).toBe(2000);
    expect(mockCanvas.height).toBe(2000);
  });

  it("handles negative crop coordinates", async () => {
    const result = await getCroppedImg("https://example.com/img.jpg", {
      x: -10, y: -20, width: 100, height: 100,
    });
    expect(result).toBe(mockBlobUrl);
  });
});
