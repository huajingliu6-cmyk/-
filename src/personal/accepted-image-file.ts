const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

export function isAcceptedImageFile(file: File): boolean {
  const type = file.type.trim().toLowerCase();
  if (
    type === "image/png" ||
    type === "image/jpeg" ||
    type === "image/webp" ||
    type === "image/jpg"
  ) {
    return true;
  }
  const name = file.name.trim().toLowerCase();
  const dot = name.lastIndexOf(".");
  if (dot < 0) return false;
  return IMAGE_EXTENSIONS.has(name.slice(dot));
}
