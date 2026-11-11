import { describe, expect, it } from "vitest";
import {
  manualParcelId,
  pnuFromParcelAddress,
} from "@/lib/parcels/parcel-id";

describe("parcel identity", () => {
  it.each([undefined, "", "unknown", "n"])("does not infer ordinary land from an unknown mountain flag %s", mountainYn => {
    const address = { bCode: "1132010500", mainAddressNo: "281", subAddressNo: "23", mountainYn, lat: 37, lng: 127 };
    expect(pnuFromParcelAddress(address)).toBeNull();
    expect(manualParcelId(address)).toBe("manual-37000000-127000000");
  });
  it("rejects a zero main lot number", () => {
    expect(pnuFromParcelAddress({ bCode: "1132010500", mainAddressNo: "0000", mountainYn: "N" })).toBeNull();
  });
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
