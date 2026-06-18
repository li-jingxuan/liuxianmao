import { CSSProperties } from "react";
import { getSvgAsset, type MusicControlIcon } from "../assets/svg/svg-assets-manifest";

type SvgMaskStyle = CSSProperties & {
  "--music-icon-url": string;
};

interface MusicAssetIconProps {
  assetId: MusicControlIcon;
  className?: string;
}

/** 使用 manifest 中的本地 SVG，并通过 mask 继承按钮当前颜色。 */
export const MusicAssetIcon: React.FC<MusicAssetIconProps> = ({ assetId, className }) => {
  const asset = getSvgAsset(assetId);
  if(!asset) {
    return <span className={className}>{ assetId }</span>
  }
  const maskStyle: SvgMaskStyle = {
    "--music-icon-url": `url("${asset.runtimePath}")`,
  };

  return (
    <span
      className={className}
      style={maskStyle}
      aria-hidden="true"
    />
  );
};
