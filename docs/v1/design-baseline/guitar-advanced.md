# 吉他进阶

## 学习与练习

- 首页「吉他进阶」进入 `/guitar-advanced`。学习总览提供「节奏与拍点」「和弦与进行」「音阶与指板」「弹奏技巧」四个模块，可自由进入。总览显示整体和模块完成度，「继续学习」或「继续练习」定位到待完成的内容。 [路由入口](../../../apps/website/app/guitar-advanced/page.tsx) · [学习总览](../../../apps/website/components/GuitarAdvanced/LearningPathOverview.tsx) · [学习导航测试](../../../apps/website/tests/guitar-advanced/navigation.test.tsx)
- 四个模块合计 8 节理论、6 项练习。理论通过「完成本节」计入进度。练习支持单选、多选、排序和指板选点，提交后显示答题结果、正确答案与解析。答错也计为完成，可重新练习复习错题。练习未提交的答案刷新后重置。 [课程与题目](../../../apps/website/data/guitar-advanced/guitar-advanced.data.ts) · [练习实现](../../../apps/website/components/GuitarAdvanced/PracticeQuestion.tsx) · [评分测试](../../../apps/website/tests/guitar-advanced/grading.test.ts)

## 综合考试

- `/guitar-advanced/exam` 列出未完成的前置内容，8 节理论和 6 项练习全部完成后解锁。固定考试共 12 题，四模块各 3 题、25 分，总分 100，80 分及以上通过。答题可前后切换或按题号定位，暂存后可继续同一份答卷。提交前确认，未答题按 0 分计，交卷后答案锁定。 [考试入口](../../../apps/website/components/GuitarAdvanced/ExamLandingPage.tsx) · [答卷实现](../../../apps/website/components/GuitarAdvanced/ExamAttemptPage.tsx) · [解锁、续答与提交测试](../../../apps/website/tests/guitar-advanced/exam-store.test.ts)
- 提交后进入 `/guitar-advanced/exam/result/[attemptId]`，可看总分、通过状态、用时、模块得分、成绩历史和本次错题。`/guitar-advanced/progress` 汇总总体和模块进度、考试成绩及练习和考试错题，可返回相关理论或练习、标记考试错题已复习，或再次考试。历史成绩及考试错题依据提交时的答卷快照，重考后同题待复习状态按新的答卷计算。 [结果页](../../../apps/website/components/GuitarAdvanced/ExamResultPage.tsx) · [学习进度页](../../../apps/website/components/GuitarAdvanced/ProgressPage.tsx) · [成绩与复习测试](../../../apps/website/tests/guitar-advanced/results.test.ts)

## 本地记录

- 学习、考试和复习记录保存在当前浏览器的 `localStorage`。当前格式 v4，按 v4、v3、v2、v1 顺序读取，把有效的旧版本迁移到 v4 并保留原记录。碰到损坏或不可读记录时进入读取保护，保留原数据并允许本次临时学习。写入失败保留页面内存中的修改，可「重试保存」。确认「清除本地进度」后移除四个版本的记录。 [进度存储实现](../../../apps/website/stores/guitar-advanced-store.tsx) · [迁移测试](../../../apps/website/tests/guitar-advanced/progress-migration.test.ts) · [损坏保护与写入重试测试](../../../apps/website/tests/guitar-advanced/storage.test.ts)

## 历史验收

- v2 记录了学习流程达到 14/14、旧记录迁移、损坏保护与清空后刷新的浏览器验收。R5 记录了综合考试的自动化验证及未解锁入口的浏览器冒烟。R6 记录了独立结果与进度页的实现、自动化验证及空进度、无效结果地址的浏览器冒烟。 [进阶能力建设归档](../../archive/mvp/versions/进阶能力建设/README.md) · [v2 实施与验收](../../archive/mvp/versions/进阶能力建设/20261018_吉他进阶MVP_v2实施与验收记录.md) · [R5 实施与验收](../../archive/mvp/versions/进阶能力建设/20261018_吉他进阶MVP_R5实施与验收记录.md) · [R6 实施与验收](../../archive/mvp/versions/进阶能力建设/20261018_吉他进阶MVP_R6实施与验收记录.md)

## 待核对的产品项

- R6 浏览器全链路人工验收仍待核对。用干净的浏览器完成 14 项内容后开考，暂存并刷新续答，再通过界面提交有错题的答卷。核对自动跳转到独立结果页、成绩与答卷一致、错题的用户答案、正确答案、解析与复习链接可用，标记已复习后刷新仍保留。再次考试答错同题，核对新答卷仍显示待复习，旧成绩仍可查看。 [R6 收尾验收清单](../../archive/mvp/versions/进阶能力建设/20261018_吉他进阶MVP_R6实施与验收记录.md#待完成的-r6-收尾验收)
