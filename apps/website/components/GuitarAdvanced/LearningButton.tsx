"use client";

import { Button, type ButtonProps } from "antd";
import { useRouter } from "next/navigation";

/**
 * 学习区链接通过客户端路由切换，配合共享布局保留内存中的学习记录。
 * 先执行调用方 onClick；调用方可用 preventDefault 阻止导航，例如拦截未保存退出。
 * 此组件只负责导航衔接，保存状态检查由调用方执行。
 */
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
