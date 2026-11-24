# 六线猫 v1.0 工作区

在这里开始新增需求、交互设计和交付审查。[v1.0 设计基线](design-baseline/README.md)记录当前分支的产品行为，供后续需求和设计对照。[MVP 归档](../archive/mvp/README.md)保留各轮历史决策和验收证据。v1.0 发布范围待确认。

首发需求、飞书与仓库编号对照、双包与桌面端排期见[六线猫 v1.0 交付计划](首发筹备/README.md)。版本与进度以[飞书「v1.0」工作表](https://pcnhehlhivqu.feishu.cn/wiki/UEivw1G7Liuaqnk20d1cqCoxnHb?sheet=D9eELE)为准。搜索与推广的筹备资料见[搜索与内容发现](首发筹备/01-搜索与内容发现.md)和[国内宣传与海外分发](首发筹备/03-国内宣传与海外分发.md)。

## 开始一个需求

1. 在[飞书需求表](https://pcnhehlhivqu.feishu.cn/wiki/UEivw1G7Liuaqnk20d1cqCoxnHb?sheet=tcgLfi)定位需求，使用同一个 REQ／BUG 编号命名专题目录。复制[需求与交互交付模板](feature-template.md)作为专题的 `README.md`，记录用户目标、范围、相关基线和验收标准。
2. 需要界面设计时，把可点击交互稿和依赖资源放在专题的 `prototype/`。以 1440px 为最小视口覆盖关键流程和异常状态，设计确认后进入开发。评审时记录采用的稿件、已确认口径和待决项。
3. 交付方案和实际验收都回链到专题入口。验收记录写清验证路径、结果及对应提交或版本，飞书按实际进度更新。

```text
docs/v1/
├── README.md
├── design-baseline/     # 当前分支的产品交互与验证依据
├── feature-template.md
└── features/
    └── REQ-NNN-功能名/
        ├── README.md        # 需求与交互规格、评审结论、交付链接
        ├── prototype/       # 交互入口和随稿资源
        ├── delivery.md      # 实施与验证方案
        └── acceptance.md    # 产品审查和验收证据
```

专题简单时，可把交付方案和验收记录写进专题 `README.md`。架构和部署说明随[对应源码及部署目录](../README.md#架构与部署)维护。
