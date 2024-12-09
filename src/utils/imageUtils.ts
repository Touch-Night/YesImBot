import path from "path";
import https from "https";

import axios from "axios";
import sharp from "sharp";

import { CacheManager } from "../managers/cacheManager";


const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB

async function compressImage(buffer: Buffer): Promise<Buffer> {
  while (buffer.length > MAX_IMAGE_SIZE) {
    const quality = Math.max(10, Math.floor((MAX_IMAGE_SIZE / buffer.length) * 80)); // 动态调整质量
    buffer = await sharp(buffer)
      .jpeg({ quality })
      .toBuffer();
  }
  return buffer;
}

const imageCache = new CacheManager<string>(path.join(__dirname, "../../data/cache/imageCache.bin"), true);

/**
 * 从URL获取图片的base64编码
 * @param url 图片的URL
 * @param cacheKey 指定缓存键，没有就用URL
 * @param [ignoreCache=false] 是否忽略缓存
 *
 * @returns 图片的base64编码，包括base64前缀
 **/
export async function convertUrltoBase64(url: string, cacheKey?: string, ignoreCache = false): Promise<string> {
  url = url.replace(/&amp;/g, "&");

  cacheKey = cacheKey ?? url;

  if (!ignoreCache && imageCache.has(cacheKey)) {
    return imageCache.get(cacheKey);
  }
  try {
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      httpsAgent: new https.Agent({ rejectUnauthorized: false }), // 忽略SSL证书验证
      timeout: 5000, // 5秒超时
    });
    if (response.status !== 200) {
      throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
    }
    let buffer = Buffer.from(response.data);
    const contentType = response.headers["content-type"] || "image/jpeg";
    buffer = await compressImage(buffer);
    const base64 = `data:${contentType};base64,${buffer.toString("base64")}`;
    await imageCache.set(cacheKey, base64);
    return base64;
  } catch (error) {
    console.error("Error converting image to base64:", error.message);
    return "";
  }
}

// 去除base64前缀
export function removeBase64Prefix(base64: string): string {
  return base64.replace(/^data:image\/(jpg|jpeg|png|webp|gif|bmp|tiff|ico|avif|webm|apng|svg);base64,/, "");
}
