import { describe, expect, it } from "vitest";
import {
  manualParcelId,
  pnuFromParcelAddress,
} from "@/lib/parcels/parcel-id";

describe("parcel identity", () => {
  it("derives the 19-digit PNU from Kakao legal-dong and lot numbers", () => {
    expect(
      pnuFromParcelAddress({
        bCode: "1132010500",
        mainAddressNo: "281",
        subAddressNo: "23",
        mountainYn: "N",
      }),
    ).toBe("1132010500102810023");
  });

  it("preserves the mountain-lot discriminator", () => {
    expect(
      pnuFromParcelAddress({
        bCode: "1132010500",
        mainAddressNo: "7",
        mountainYn: "Y",
      }),
    ).toBe("1132010500200070000");
  });

  it("uses a deterministic coordinate id when parcel numbers are unavailable", () => {
    expect(
      manualParcelId({
        bCode: "",
        mainAddressNo: "",
        lat: 37.6481234,
        lng: 127.0345678,
      }),
    ).toBe("manual-37648123-127034568");
  });
});
