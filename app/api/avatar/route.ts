import {
  updateAvatarRateLimit,
  uploadAvatarRateLimit,
} from "@/lib/essentials/rateLimit";
import { auth } from "@/auth";
import { db } from "@/database/drizzle";
import { users } from "@/database/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import ImageKit from "imagekit";
import config from "@/lib/config";

export async function PUT(request: Request) {
  const { image } = await request.json();

  if (!image) {
    return NextResponse.json({ error: "Image is required" }, { status: 400 });
  }
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { success } = await uploadAvatarRateLimit.limit(session.user.id);

    if (!success) {
      return NextResponse.json(
        {
          error: "You can only upload your avatar 10 times per day.",
        },
        { status: 429 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Avatar upload error:", error);
    return NextResponse.json(
      { error: "Failed to upload avatar" },
      { status: 500 },
    );
  }
}
export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { success } = await updateAvatarRateLimit.limit(session.user.id);

    if (!success) {
      return NextResponse.json(
        {
          error: "You can only update your avatar 5 times per day.",
        },
        { status: 429 },
      );
    }

    const { imageUrl, fileId } = await request.json();

    if (!imageUrl || !fileId) {
      return NextResponse.json(
        { error: "Image URL and File ID are required" },
        { status: 400 },
      );
    }

    const imagekit = new ImageKit({
      publicKey: config.env.imagekit.publicKey,
      privateKey: config.env.imagekit.privateKey,
      urlEndpoint: config.env.imagekit.urlEndpoint,
    });

    const existingUser = await db
      .select({ userAvatarFileId: users.userAvatarFileId })
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1);

    if (existingUser.length > 0 && existingUser[0].userAvatarFileId) {
      try {
        await imagekit.deleteFile(existingUser[0].userAvatarFileId);
      } catch (error) {
        console.error("Failed to delete old avatar:", error);
      }
    }

    await db
      .update(users)
      .set({ userAvatar: imageUrl, userAvatarFileId: fileId })
      .where(eq(users.id, session.user.id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Avatar update error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
