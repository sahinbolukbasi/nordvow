"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { attempt, optStr, revalidateAll, str, tags } from "@/lib/action-utils";
import { requireActor } from "@/lib/auth-guard";
import type { BlogAudience, BlogStatus } from "@infulancer/core/enums";
import {
  createBlogPost,
  deleteBlogPost,
  seedStarterBlogPosts,
  updateBlogPost,
} from "@infulancer/core/blog/service";

export async function saveBlogPostAction(
  _p: ActionState,
  fd: FormData,
): Promise<ActionState> {
  await requireActor("ADMIN");
  return attempt(async () => {
    const id = optStr(fd, "id");
    const statusRaw = str(fd, "status");
    const status: BlogStatus = statusRaw === "PUBLISHED" ? "PUBLISHED" : "DRAFT";
    const audienceRaw = str(fd, "targetAudience");
    const targetAudience: BlogAudience =
      audienceRaw === "BRAND" || audienceRaw === "INFLUENCER" ? audienceRaw : "ALL";

    const payload = {
      title: str(fd, "title"),
      slug: optStr(fd, "slug"),
      excerpt: str(fd, "excerpt"),
      content: str(fd, "content"),
      coverImageUrl: optStr(fd, "coverImageUrl"),
      category: optStr(fd, "category") ?? "Influencer Pazarlama",
      tags: tags(str(fd, "tags")),
      targetAudience,
      status,
      seoTitle: optStr(fd, "seoTitle"),
      seoDescription: optStr(fd, "seoDescription"),
      seoKeywords: tags(str(fd, "seoKeywords")),
      authorName: optStr(fd, "authorName") ?? "Nordvow Editör",
    };

    if (id) {
      await updateBlogPost(id, payload);
      revalidatePath("/admin/blog");
      revalidatePath("/blog");
      revalidatePath("/sitemap.xml");
      revalidateAll();
      return { ok: true, message: status === "PUBLISHED" ? "Blog yazısı güncellendi ve yayımlandı." : "Blog yazısı taslak olarak güncellendi." };
    }
    await createBlogPost(payload);
    revalidatePath("/admin/blog");
    revalidatePath("/blog");
    revalidatePath("/sitemap.xml");
    revalidateAll();
    return { ok: true, message: status === "PUBLISHED" ? "Blog yazısı oluşturuldu ve yayımlandı." : "Blog yazısı taslak olarak kaydedildi." };
  });
}

export async function toggleBlogPostStatusAction(
  id: string,
  status: BlogStatus,
): Promise<ActionState> {
  await requireActor("ADMIN");
  return attempt(async () => {
    const existing = await (await import("@infulancer/core/db")).prisma.blogPost.findUniqueOrThrow({
      where: { id },
      select: { title: true, excerpt: true, content: true },
    });
    await updateBlogPost(id, {
      title: existing.title,
      excerpt: existing.excerpt,
      content: existing.content,
      status,
    });
    revalidatePath("/admin/blog");
    revalidatePath("/blog");
    revalidatePath("/sitemap.xml");
    revalidateAll();
    return {
      ok: true,
      message: status === "PUBLISHED" ? "Blog yazısı yayımlandı." : "Blog yazısı taslağa alındı.",
    };
  });
}

export async function deleteBlogPostAction(id: string): Promise<ActionState> {
  await requireActor("ADMIN");
  return attempt(async () => {
    await deleteBlogPost(id);
    revalidateAll();
    return { ok: true, message: "Blog yazısı silindi." };
  });
}

export async function seedStarterBlogPostsAction(): Promise<ActionState> {
  await requireActor("ADMIN");
  return attempt(async () => {
    const res = await seedStarterBlogPosts();
    revalidateAll();
    return {
      ok: true,
      message: `${res.created} yeni SEO blog yazısı eklendi.`,
    };
  });
}

