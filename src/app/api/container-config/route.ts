import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, unauthorized } from "@/lib/auth-guard";
import {
  getContainerSpecs,
  recommendContainer,
} from "@/lib/container-optimizer";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return unauthorized();

  const configs = await getContainerSpecs();
  return NextResponse.json(configs);
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();

  const body = await req.json();

  // Container calculator endpoint
  if (body.calculate) {
    const { totalWeightKg, totalVolumeCbm } = body;
    const specs = await getContainerSpecs();
    const recommendation = recommendContainer(
      totalWeightKg || 0,
      totalVolumeCbm || 0,
      specs
    );
    return NextResponse.json(recommendation);
  }

  return NextResponse.json({ error: "Invalid request" }, { status: 400 });
}
