import "server-only";



import { isSd2CertifiedForVideoRef } from "@/video-generation/sd2-cert-safety";

import { precheckImageBufferWithSd2Cert } from "@/video-generation/sd2-image-video-ref-precheck";

import type { VideoRefSafety } from "@/projects/assets/types";



export async function precheckPersonalVideoReferenceImage(params: {

  buffer: Buffer;

  mimeType: string;

  label?: string;

  fetchImpl?: typeof fetch;

}): Promise<VideoRefSafety> {

  return precheckImageBufferWithSd2Cert(params);

}



export function isPersonalVideoReferenceBlocked(

  safety: VideoRefSafety,

): boolean {

  return !isSd2CertifiedForVideoRef(safety);

}

