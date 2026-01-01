import dummyBooks from "@/dummyBooks.json";
import { books } from "./schema";
import ImageKit from "imagekit";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { config } from "dotenv";

config({ path: ".env.local" });

const sql = neon(process.env.DATABASE_URL!);
export const db = drizzle({ client: sql });

const imagekit = new ImageKit({
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY!,
  publicKey: process.env.NEXT_PUBLIC_IMAGEKIT_PUBLIC_KEY!,
  urlEndpoint: process.env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT!,
});

const uploadtoImageKit = async (
  url: string,
  fileName: string,
  folder: string
) => {
  try {
    const response = await imagekit.upload({
      file: url,
      fileName,
      folder,
    });
    return response.url;
  } catch (error) {
    console.error("Error uploading to ImageKit:", error);
  }
};

const seed = async () => {
  console.log("Seeding database...");

  try {
    for (const book of dummyBooks) {
      const coverUrl = await uploadtoImageKit(
        book.coverUrl,
        `${book.title}.jpg`,
        "/books/covers"
      );
      const videoUrl = await uploadtoImageKit(
        book.videoUrl,
        `${book.title}.mp4`,
        "/books/videos"
      );

      if (!coverUrl || !videoUrl) {
        console.error(`Failed to upload images for ${book.title}`);
        continue;
      }

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id: _id, ...bookData } = book;

      await db.insert(books).values({
        ...bookData,
        coverUrl,
        videoUrl,
      });
    }

    console.log("Data seeded successfully!");
  } catch (error) {
    console.error("Error seeding database:", error);
  }
};

seed();
