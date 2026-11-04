import { describe, expect, it } from "vitest";
import {
  EXAMPLE_MVP_7_2_DOCUMENT,
  LXMScoreCommandEnum,
} from "@liuxianmao/lxm-editor";
import { createEditorSession } from "../stores/editor-store";
import {
  readScoreSettings,
  prepareSettingsSubmission,
  submitSettingsDraft,
  rebaseSettingsDraft,
  reconcileSettingsDraft,
  isSettingsGroupDirty,
} from "../components/EditorShell/score-settings-draft";

const setup = () => {
  const session = createEditorSession(EXAMPLE_MVP_7_2_DOCUMENT);
  const document = session.getState().document!;
  const measureId = document.score.tracks[0]!.measures[0]!.id;
  const initial = readScoreSettings(document, measureId);
  return { session, document, measureId, initial };
};

describe("设置表单提交适配", () => {
  it("外部无关修改重基干净字段，保留未应用组且不产生冲突", () => {
    const { initial } = setup();
    const value = { ...initial, title: "未应用名称", capo: "3" };
    const fresh = { ...initial, arranger: "外部作者", label: "外部段落" };
    const result = reconcileSettingsDraft(value, initial, fresh);
    expect(result.value).toMatchObject({ title: "未应用名称", capo: "3", arranger: "外部作者", label: "外部段落" });
    expect(result.initial).toEqual(fresh);
    expect(result.conflicts).toEqual({});
    expect(isSettingsGroupDirty(result.value, result.initial, "info")).toBe(true);
    expect(isSettingsGroupDirty(result.value, result.initial, "label")).toBe(false);
  });
  it("同字段外部更改保留原文与旧基线，普通重渲染或撤销不能静默解除冲突", () => {
    const { initial } = setup();
    const value = { ...initial, title: "我的名称", capo: "3" };
    const fresh = { ...initial, title: "外部名称" };
    const first = reconcileSettingsDraft(value, initial, fresh);
    expect(first.value.title).toBe("我的名称");
    expect(first.initial.title).toBe(initial.title);
    expect(first.conflicts.info).toMatch(/发生变化/);
    expect(first.conflicts.capo).toBeUndefined();
    const repeated = reconcileSettingsDraft(first.value, first.initial, fresh, first.conflicts);
    expect(repeated).toEqual(first);
    const undone = reconcileSettingsDraft(first.value, first.initial, initial, first.conflicts);
    expect(undone.conflicts.info).toBe(first.conflicts.info);
  });
  it("自身成功仅重基成功组，其他组冲突与原文继续保留", () => {
    const { initial } = setup();
    const value = { ...initial, title: "新名称", capo: "3", label: "我的段落" };
    const next = { ...initial, title: "新名称", label: "外部段落" };
    const result = reconcileSettingsDraft(value, initial, next, {}, ["info"]);
    expect(isSettingsGroupDirty(result.value, result.initial, "info")).toBe(false);
    expect(result.conflicts.info).toBeUndefined();
    expect(result.value.capo).toBe("3");
    expect(result.conflicts.capo).toBeUndefined();
    expect(result.value.label).toBe("我的段落");
    expect(result.conflicts.label).toMatch(/发生变化/);
  });
  it("原小节删除后的局部输入仍可查看，但不能写入另一个小节", () => {
    const { document, initial, measureId } = setup();
    const changed = structuredClone(document);
    changed.score.tracks[0]!.measures = changed.score.tracks[0]!.measures.filter((measure) => measure.id !== measureId);
    const result = reconcileSettingsDraft({ ...initial, label: "待处理段落" }, initial, readScoreSettings(changed, measureId));
    expect(result.value.label).toBe("待处理段落");
    expect(prepareSettingsSubmission(changed, result.value, result.initial, measureId, "label")).toMatchObject({ ok: false, issue: { group: "label" } });
    expect(prepareSettingsSubmission(changed, { ...result.value, title: "可独立处理" }, result.initial, measureId, "info").ok).toBe(true);
  });
  it("多组先整体预验证，越界/空值/小数 Capo 不会先写入合法歌曲名称", () => {
    for (const capo of ["", " ", "13", "-1", "1.5", "abc"]) {
      const { session, initial, measureId } = setup();
      const result = submitSettingsDraft({
        getState: session.getState,
        commit: session.getState().execute,
        value: { ...initial, title: "合法修改", capo },
        initial,
        measureId,
      });
      expect(result).toMatchObject({
        status: "blocked",
        submittedGroups: [],
        issue: { group: "capo" },
      });
      expect(session.getState().historyDepth.past).toBe(0);
      expect(session.getState().document?.score.title).toBe(initial.title);
    }
  });
  it("只应用 info 时保持其他非法组草稿；空标题允许，成功后采用核心规范化值", () => {
    const { session, initial, measureId } = setup();
    const value = { ...initial, title: "  ", arranger: " 作者 ", capo: "13" };
    const result = submitSettingsDraft({
      getState: session.getState,
      commit: session.getState().execute,
      value,
      initial,
      measureId,
      group: "info",
    });
    expect(result.status).toBe("applied");
    const fresh = readScoreSettings(session.getState().document!, measureId);
    expect(fresh).toMatchObject({ title: "", arranger: "作者" });
    expect(
      rebaseSettingsDraft(value, initial, fresh, result.submittedGroups),
    ).toMatchObject({ title: "", arranger: "作者", capo: "13" });
    expect(session.getState().historyDepth.past).toBe(1);
  });
  it("长文本和控制字符由核心拒绝，不写历史或丢弃原文", () => {
    for (const title of ["长".repeat(129), "标题\n第二行"]) {
      const { session, initial } = setup();
      const value = { ...initial, title };
      expect(
        submitSettingsDraft({
          getState: session.getState,
          commit: session.getState().execute,
          value,
          initial,
          group: "info",
        }),
      ).toMatchObject({ status: "blocked", issue: { group: "info" } });
      expect(value.title).toBe(title);
      expect(session.getState().historyDepth.past).toBe(0);
    }
  });
  it("局部标记必须有原小节目标，清空标记通过真正的领域命令执行", () => {
    const { session, document, initial, measureId } = setup();
    expect(
      prepareSettingsSubmission(
        document,
        { ...initial, label: "A" },
        initial,
        "missing",
        "label",
      ),
    ).toMatchObject({ ok: false, issue: { group: "label" } });
    expect(
      submitSettingsDraft({
        getState: session.getState,
        commit: session.getState().execute,
        value: { ...initial, label: "A" },
        initial,
        measureId,
        group: "label",
      }).status,
    ).toBe("applied");
    const labeled = readScoreSettings(session.getState().document!, measureId);
    expect(labeled.label).toBe("A");
    expect(
      submitSettingsDraft({
        getState: session.getState,
        commit: session.getState().execute,
        value: { ...labeled, label: "" },
        initial: labeled,
        measureId,
        group: "label",
      }).status,
    ).toBe("applied");
    expect(
      readScoreSettings(session.getState().document!, measureId).label,
    ).toBe("");
    session.getState().undo();
    expect(
      readScoreSettings(session.getState().document!, measureId).label,
    ).toBe("A");
  });
  it("noop 不新增历史，四组只生成对应命令", () => {
    const { session, document, initial, measureId } = setup();
    const values = {
      info: { ...initial, title: "歌曲" },
      capo: { ...initial, capo: "2" },
      signature: { ...initial, signature: "4/4" },
      label: { ...initial, label: "副歌" },
    };
    for (const group of ["info", "capo", "label"] as const) {
      const plan = prepareSettingsSubmission(
        document,
        values[group],
        initial,
        measureId,
        group,
      );
      expect(plan.ok && plan.commands.map((entry) => entry.group)).toEqual([
        group,
      ]);
    }
    const result = submitSettingsDraft({
      getState: session.getState,
      commit: session.getState().execute,
      value: initial,
      initial,
      group: "info",
    });
    expect(result.status).toBe("applied");
    expect(session.getState().historyDepth.past).toBe(0);
  });
  it("中途提交失败保留成功组历史与剩余输入，不假装跨命令事务", () => {
    const { session, initial, measureId } = setup();
    const value = { ...initial, title: "已提交名称", capo: "4" };
    const result = submitSettingsDraft({
      getState: session.getState,
      commit: (command) =>
        command.type === LXMScoreCommandEnum.SetCapo
          ? null
          : session.getState().execute(command),
      value,
      initial,
      measureId,
    });
    expect(result).toMatchObject({
      status: "blocked",
      submittedGroups: ["info"],
      issue: { group: "capo" },
    });
    expect(session.getState().historyDepth.past).toBe(1);
    expect(
      rebaseSettingsDraft(
        value,
        initial,
        readScoreSettings(session.getState().document!, measureId),
        result.submittedGroups,
      ).capo,
    ).toBe("4");
  });
  it("宿主同步改写文档后停止剩余命令，干净字段跟随宿主，未提交草稿保持", () => {
    let changed = false;
    const session = createEditorSession(EXAMPLE_MVP_7_2_DOCUMENT, {
      onChange: () => {
        if (changed) return;
        changed = true;
        const trackId = session.getState().document!.score.tracks[0]!.id;
        session
          .getState()
          .execute({ type: LXMScoreCommandEnum.SetCapo, trackId, capo: 7 });
      },
    });
    const initial = readScoreSettings(session.getState().document!);
    const value = { ...initial, title: "当前修改", capo: "4" };
    const result = submitSettingsDraft({
      getState: session.getState,
      commit: session.getState().execute,
      value,
      initial,
    });
    expect(result).toMatchObject({
      status: "stale",
      submittedGroups: ["info"],
    });
    expect(readScoreSettings(session.getState().document!).capo).toBe("7");
    const fresh = readScoreSettings(session.getState().document!);
    expect(
      rebaseSettingsDraft(value, initial, fresh, result.submittedGroups),
    ).toMatchObject({ title: "当前修改", capo: "4" });
    expect(session.getState().historyDepth.past).toBe(2);
  });
  it("宿主替换同 ID 会话后不向新文档继续应用剩余设置", () => {
    let replaced = false;
    const session = createEditorSession(EXAMPLE_MVP_7_2_DOCUMENT, {
      onChange: () => {
        if (replaced) return;
        replaced = true;
        session.getState().replaceDocument(EXAMPLE_MVP_7_2_DOCUMENT);
      },
    });
    const initial = readScoreSettings(session.getState().document!);
    expect(
      submitSettingsDraft({
        getState: session.getState,
        commit: session.getState().execute,
        value: { ...initial, title: "旧会话输入", capo: "4" },
        initial,
      }).status,
    ).toBe("stale");
    expect(readScoreSettings(session.getState().document!)).toEqual(initial);
    expect(session.getState().historyDepth.past).toBe(0);
  });
});
