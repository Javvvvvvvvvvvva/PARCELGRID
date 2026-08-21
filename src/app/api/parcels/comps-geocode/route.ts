/**
 * 실거래 지오코딩 API — 행정구역 중심의 근사 배치.
 *
 * MOLIT 토지 실거래 주소는 지번을 마스킹하므로 개별 필지 좌표로 표시할 수 없다.
 * 대상지의 시·군·구와 거래 주소의 동·읍·면을 결합해 행정구역 중심을 찾고,
 * 겹치는 점만 작은 반경으로 분산한다. 응답 좌표는 언제나 근사값이다.
 *
 * POST body:
 * {
 *   addresses: string[];
 *   contextAddress: string;
 *   contextLat?: number;
 *   contextLng?: number;
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { geocodeAddress } from "@/lib/integrations/kakao";
import {
  buildCompGeocodeQuery,
  coordinateDistanceKm,
  scatterApproximateCoordinate,
} from "@/lib/geo/comps-geocode";

export const runtime = "nodejs";

const requestSchema = z
  .object({
    addresses: z
      .array(z.string().trim().min(1).max(120))
      .max(500),
    contextAddress: z.string().trim().min(1).max(200),
    contextLat: z.number().finite().min(-90).max(90).optional(),
    contextLng: z.number().finite().min(-180).max(180).optional(),
  })
  .refine(
    ({ contextLat, contextLng }) =>
      (contextLat == null) === (contextLng == null),
    {
      message: "contextLat과 contextLng는 함께 입력해야 합니다.",
      path: ["contextLat"],
    },
  );

export async function POST(req: NextRequest) {
  try {
    const parsed = requestSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "실거래 위치 요청값이 올바르지 않습니다.",
          details: parsed.error.flatten(),
        },
        { status: 422 },
      );
    }

    const {
      addresses,
      contextAddress,
      contextLat,
      contextLng,
    } = parsed.data;
    const subjectCoordinate =
      contextLat != null && contextLng != null
        ? { lat: contextLat, lng: contextLng }
        : null;

    const queries = addresses.map((address) =>
      buildCompGeocodeQuery(address, contextAddress),
    );
    const uniqueQueries = Array.from(
      new Set(queries.filter((query): query is string => query != null)),
    );

    const queryEntries = await Promise.all(
      uniqueQueries.map(async (query) => {
        try {
          const result = await geocodeAddress(query);
          if (!result) return [query, null] as const;

          const coordinate = { lat: result.lat, lng: result.lng };
          if (
            subjectCoordinate &&
            coordinateDistanceKm(subjectCoordinate, coordinate) > 50
          ) {
            console.warn(
              `[comps-geocode] 대상지와 50km 이상 떨어진 지오코딩 결과 제외: ${query}`,
            );
            return [query, null] as const;
          }
          return [query, coordinate] as const;
        } catch (error) {
          console.warn(`[comps-geocode] 지오코딩 실패: ${query}`, error);
          return [query, null] as const;
        }
      }),
    );
    const queryCache = new Map(queryEntries);
    const queryIndex = new Map<string, number>();

    const coords = queries.map((query) => {
      if (!query) return null;
      const base = queryCache.get(query);
      if (!base) return null;

      const index = queryIndex.get(query) ?? 0;
      queryIndex.set(query, index + 1);
      const coordinate = scatterApproximateCoordinate(
        base.lat,
        base.lng,
        index,
      );
      return {
        ...coordinate,
        approx: true as const,
        query,
      };
    });

    return NextResponse.json({
      coords,
      approximation: "administrative-area-scatter",
      contextAddress,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "실거래 위치를 계산하지 못했습니다.",
      },
      { status: 500 },
    );
  }
}
