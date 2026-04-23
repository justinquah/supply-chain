import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, unauthorized, forbidden } from "@/lib/auth-guard";
import {
  getShopPerformance,
  getProductStats,
  getGMVTrend,
  getBestsellers,
  getLivePerformance,
} from "@/lib/tiktok-shop";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();

  const { searchParams } = req.nextUrl;
  const type = searchParams.get("type"); // performance, products, gmv, bestsellers, live
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");

  if (!type || !startDate || !endDate) {
    return NextResponse.json(
      { error: "type, startDate, and endDate required" },
      { status: 400 }
    );
  }

  try {
    let data;

    switch (type) {
      case "performance":
        data = await getShopPerformance({
          start_date: startDate,
          end_date: endDate,
        });
        break;

      case "products":
        data = await getProductStats({
          start_date: startDate,
          end_date: endDate,
        });
        break;

      case "gmv":
        data = await getGMVTrend({
          start_date: startDate,
          end_date: endDate,
        });
        break;

      case "bestsellers":
        data = await getBestsellers({
          start_date: startDate,
          end_date: endDate,
        });
        break;

      case "live":
        data = await getLivePerformance({
          start_date: startDate,
          end_date: endDate,
        });
        break;

      default:
        return NextResponse.json(
          { error: "Invalid type. Use: performance, products, gmv, bestsellers, live" },
          { status: 400 }
        );
    }

    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to fetch analytics" },
      { status: 500 }
    );
  }
}
