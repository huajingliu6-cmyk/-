import { PrismaClient } from "@prisma/client";

/**
 * Dev/test seed only. Never run automatically in production.
 * No real passwords, API keys, balances, or project data.
 */
const prisma = new PrismaClient();

const VOICES = [
  {
    publicKey: "voice_gentle-female",
    displayName: "温柔女声",
    providerKey: "config",
    providerVoiceId: "gentle-female",
    style: "女声·温柔",
  },
  {
    publicKey: "voice_young-male",
    displayName: "年轻男声",
    providerKey: "config",
    providerVoiceId: "young-male",
    style: "男声·清朗",
  },
  {
    publicKey: "voice_mature-male",
    displayName: "成熟男声",
    providerKey: "config",
    providerVoiceId: "mature-male",
    style: "男声·低沉",
  },
  {
    publicKey: "voice_narrator-doc",
    displayName: "旁白音色",
    providerKey: "config",
    providerVoiceId: "narrator-doc",
    style: "旁白·纪录片",
  },
];

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run prisma seed in production");
  }

  for (const voice of VOICES) {
    await prisma.voiceProfile.upsert({
      where: { publicKey: voice.publicKey },
      create: voice,
      update: {
        displayName: voice.displayName,
        providerKey: voice.providerKey,
        providerVoiceId: voice.providerVoiceId,
        style: voice.style,
        enabled: true,
      },
    });
  }

  console.log(`Seeded ${VOICES.length} voice profiles (dev catalog).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
