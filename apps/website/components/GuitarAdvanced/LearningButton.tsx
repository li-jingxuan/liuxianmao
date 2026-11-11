"use client";

import { Button, type ButtonProps } from "antd";
import { useRouter } from "next/navigation";

/** 学习区按钮由共享布局内的路由切换，避免整页加载丢失尚未保存的记录。 */
export const LearningButton = ({ href, onClick, ...props }: ButtonProps) => {
  const router = useRouter();
  return (
    <Button
      {...props}
      onClick={(event) => {
        onClick?.(event);
        if (href && !event.defaultPrevented) router.push(href);
      }}
    />
  );
};
