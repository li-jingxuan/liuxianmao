const config = {
  plugins: {
    "postcss-pxtorem": {
      rootValue: 16,
      unitPrecision: 5,
      // 背景纹理保持固定像素密度；其余组件尺寸统一转换为 rem。
      propList: ["*", "!background", "!background-size"],
      minPixelValue: 2,
      // 断点描述视口宽度，不随根字号变化。
      mediaQuery: false,
      // 当前仅改造拼豆转换器，避免影响全局样式和其他组件。
      exclude: (filePath) =>
        !filePath.endsWith("pindou-converter.module.scss"),
    },
  },
};

export default config;
