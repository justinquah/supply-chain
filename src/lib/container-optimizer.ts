import { prisma } from "./prisma";

export type ContainerRecommendation = {
  recommendedType: "20FT" | "40FT" | "LCL" | "MULTIPLE";
  totalWeightKg: number;
  totalVolumeCbm: number;
  weightUtilization: number; // percentage
  volumeUtilization: number; // percentage
  fits: boolean;
  estimatedCost: number;
  details: string;
  // For multiple containers
  containerCount?: number;
};

export type ContainerSpec = {
  type: string;
  maxWeightKg: number;
  maxVolumeCbm: number;
  estimatedCost: number;
};

export async function getContainerSpecs(): Promise<ContainerSpec[]> {
  return prisma.containerConfig.findMany({
    orderBy: { maxVolumeCbm: "asc" },
  });
}

export function recommendContainer(
  totalWeightKg: number,
  totalVolumeCbm: number,
  specs: ContainerSpec[]
): ContainerRecommendation {
  // LCL threshold: under 10 CBM and under 5000 kg
  if (totalVolumeCbm < 10 && totalWeightKg < 5000) {
    return {
      recommendedType: "LCL",
      totalWeightKg,
      totalVolumeCbm,
      weightUtilization: 0,
      volumeUtilization: 0,
      fits: true,
      estimatedCost: Math.round(totalVolumeCbm * 300), // rough LCL rate per CBM
      details: `LCL shipment: ${totalVolumeCbm.toFixed(2)} CBM, ${totalWeightKg.toFixed(1)} kg. Cost-effective for small loads.`,
    };
  }

  // Try each container size (ordered smallest first)
  for (const spec of specs) {
    const weightUtil = (totalWeightKg / spec.maxWeightKg) * 100;
    const volumeUtil = (totalVolumeCbm / spec.maxVolumeCbm) * 100;

    if (totalWeightKg <= spec.maxWeightKg && totalVolumeCbm <= spec.maxVolumeCbm) {
      return {
        recommendedType: spec.type as "20FT" | "40FT",
        totalWeightKg,
        totalVolumeCbm,
        weightUtilization: Math.round(weightUtil * 10) / 10,
        volumeUtilization: Math.round(volumeUtil * 10) / 10,
        fits: true,
        estimatedCost: spec.estimatedCost,
        details: `${spec.type} container: ${weightUtil.toFixed(1)}% weight, ${volumeUtil.toFixed(1)}% volume utilized.`,
      };
    }
  }

  // Exceeds largest container - calculate multiple
  const largest = specs[specs.length - 1];
  if (largest) {
    const byWeight = Math.ceil(totalWeightKg / largest.maxWeightKg);
    const byVolume = Math.ceil(totalVolumeCbm / largest.maxVolumeCbm);
    const containerCount = Math.max(byWeight, byVolume);

    return {
      recommendedType: "MULTIPLE",
      totalWeightKg,
      totalVolumeCbm,
      weightUtilization: (totalWeightKg / (largest.maxWeightKg * containerCount)) * 100,
      volumeUtilization: (totalVolumeCbm / (largest.maxVolumeCbm * containerCount)) * 100,
      fits: false,
      estimatedCost: largest.estimatedCost * containerCount,
      details: `Requires ${containerCount}x ${largest.type} containers. Consider splitting into multiple POs.`,
      containerCount,
    };
  }

  return {
    recommendedType: "LCL",
    totalWeightKg,
    totalVolumeCbm,
    weightUtilization: 0,
    volumeUtilization: 0,
    fits: true,
    estimatedCost: 0,
    details: "No container configs found. Please set up container configurations.",
  };
}

/**
 * Calculate weight and volume for a set of line items
 */
export function calculateLoadTotals(
  lineItems: { quantity: number; weightPerUnit: number; volumePerUnit: number }[]
): { totalWeightKg: number; totalVolumeCbm: number } {
  let totalWeightKg = 0;
  let totalVolumeCbm = 0;

  for (const item of lineItems) {
    totalWeightKg += item.quantity * item.weightPerUnit;
    totalVolumeCbm += item.quantity * item.volumePerUnit;
  }

  return {
    totalWeightKg: Math.round(totalWeightKg * 100) / 100,
    totalVolumeCbm: Math.round(totalVolumeCbm * 10000) / 10000,
  };
}
