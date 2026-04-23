"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type ContainerRec = {
  recommendedType: string;
  totalWeightKg: number;
  totalVolumeCbm: number;
  weightUtilization: number;
  volumeUtilization: number;
  fits: boolean;
  estimatedCost: number;
  details: string;
  containerCount?: number;
};

export default function ContainerCalculatorPage() {
  const [weight, setWeight] = useState("");
  const [volume, setVolume] = useState("");
  const [result, setResult] = useState<ContainerRec | null>(null);
  const [loading, setLoading] = useState(false);

  async function calculate() {
    setLoading(true);
    const res = await fetch("/api/container-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        calculate: true,
        totalWeightKg: parseFloat(weight) || 0,
        totalVolumeCbm: parseFloat(volume) || 0,
      }),
    });
    if (res.ok) setResult(await res.json());
    setLoading(false);
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold">Container Calculator</h1>
        <p className="text-sm text-gray-500">
          Calculate optimal container size based on shipment weight and volume
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Shipment Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Total Weight (kg)</Label>
              <Input
                type="number"
                step="0.1"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                placeholder="e.g. 15000"
              />
            </div>
            <div className="space-y-2">
              <Label>Total Volume (CBM)</Label>
              <Input
                type="number"
                step="0.01"
                value={volume}
                onChange={(e) => setVolume(e.target.value)}
                placeholder="e.g. 25.5"
              />
            </div>
          </div>
          <Button onClick={calculate} disabled={loading}>
            {loading ? "Calculating..." : "Calculate"}
          </Button>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle>Recommendation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              className={`p-4 rounded-lg border ${
                result.fits
                  ? "bg-green-50 border-green-200"
                  : "bg-amber-50 border-amber-200"
              }`}
            >
              <div className="text-lg font-bold mb-1">
                {result.recommendedType === "MULTIPLE"
                  ? `${result.containerCount}x 40FT Containers`
                  : result.recommendedType === "LCL"
                  ? "LCL (Less than Container Load)"
                  : `${result.recommendedType} Container`}
              </div>
              <p className="text-sm text-gray-600">{result.details}</p>
            </div>

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-600">Weight</span>
                  <span>{result.totalWeightKg.toFixed(1)} kg</span>
                </div>
                {result.weightUtilization > 0 && (
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full ${
                        result.weightUtilization > 90
                          ? "bg-red-500"
                          : result.weightUtilization > 70
                          ? "bg-amber-500"
                          : "bg-green-500"
                      }`}
                      style={{
                        width: `${Math.min(100, result.weightUtilization)}%`,
                      }}
                    />
                  </div>
                )}
                <div className="text-xs text-gray-500 text-right">
                  {result.weightUtilization > 0
                    ? `${result.weightUtilization}% utilized`
                    : "N/A"}
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-600">Volume</span>
                  <span>{result.totalVolumeCbm.toFixed(2)} CBM</span>
                </div>
                {result.volumeUtilization > 0 && (
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full ${
                        result.volumeUtilization > 90
                          ? "bg-red-500"
                          : result.volumeUtilization > 70
                          ? "bg-amber-500"
                          : "bg-green-500"
                      }`}
                      style={{
                        width: `${Math.min(100, result.volumeUtilization)}%`,
                      }}
                    />
                  </div>
                )}
                <div className="text-xs text-gray-500 text-right">
                  {result.volumeUtilization > 0
                    ? `${result.volumeUtilization}% utilized`
                    : "N/A"}
                </div>
              </div>
            </div>

            {result.estimatedCost > 0 && (
              <div className="flex justify-between text-sm font-medium pt-2 border-t">
                <span>Estimated Shipping Cost</span>
                <span>~RM {result.estimatedCost.toLocaleString()}</span>
              </div>
            )}

            {/* Reference table */}
            <div className="mt-4">
              <h4 className="text-sm font-medium mb-2">Container Reference</h4>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b">
                    <th className="py-1 text-left">Type</th>
                    <th className="py-1 text-right">Max Weight</th>
                    <th className="py-1 text-right">Max Volume</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b">
                    <td className="py-1">20ft (TEU)</td>
                    <td className="py-1 text-right">21,700 kg</td>
                    <td className="py-1 text-right">33.2 CBM</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-1">40ft (FEU)</td>
                    <td className="py-1 text-right">26,500 kg</td>
                    <td className="py-1 text-right">67.7 CBM</td>
                  </tr>
                  <tr>
                    <td className="py-1">LCL</td>
                    <td className="py-1 text-right" colSpan={2}>
                      {"< 10 CBM / < 5,000 kg"}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
