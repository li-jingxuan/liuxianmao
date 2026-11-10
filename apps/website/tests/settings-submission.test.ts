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
  acknowledgeScoreInfo,
  changeScoreSettingsField,
} from "../components/EditorShell/score-settings-draft";

const setup = () => {
  const session = createEditorSession(EXAMPLE_MVP_7_2_DOCUMENT);
  const document = session.getState().document!;
  const measureId = document.score.tracks[0]!.measures[0]!.id;
  const initial = readScoreSettings(document, measureId);
  return { session, document, measureId, initial };
};

describe("设置表单提交适配", () => {
  it("info 整组保留并捕获作者外部修改，其他干净组继续刷新", () => {
    const { initial } = setup();
    const value = { ...initial, title: "未应用名称", capo: "3" };
    const fresh = { ...initial, arranger: "外部作者", label: "外部段落" };
    const result = reconcileSettingsDraft(value, initial, fresh);
    expect(result.value).toMatchObject({ title: "未应用名称", capo: "3", arranger: initial.arranger, label: "外部段落" });
    expect(result.initial.arranger).toBe(initial.arranger);
    expect(result.conflicts.info).toMatch(/整组/);
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

describe("曲谱调性整组设置", () => {
  it("set 意图同步计算数字 1，小调记法切换仍用一条 info 命令", () => {
    const { document, initial } = setup();
    for (const minorTonicDegree of [1, 6] as const) {
      const value = changeScoreSettingsField(initial, "tonalityIntent", { kind: "set", value: { version: 1, tonic: "A", mode: "minor", minorTonicDegree } });
      expect(value.keySignature).toBe(minorTonicDegree === 6 ? "C" : "A");
      const plan = prepareSettingsSubmission(document, { ...value, capo: "13" }, initial, undefined, "info");
      expect(plan.ok).toBe(true);
      if (plan.ok) expect(plan.commands).toMatchObject([{ group: "info", command: { type: LXMScoreCommandEnum.SetScoreInfo, tonality: { minorTonicDegree } } }]);
    }
  });
  it("命名空间原值为独立快照，键序不同不冲突，其他 namespace 变化不冲突", () => {
    const { document } = setup();
    document.score.meta["lxm:tonality"] = { version: 9, data: { a: 1, b: [2, 3] } };
    const initial = readScoreSettings(document);
    const value = { ...initial, title: "草稿" };
    document.score.meta["lxm:tonality"] = { data: { b: [2, 3], a: 1 }, version: 9 };
    document.score.meta.other = { changed: true };
    const reordered = reconcileSettingsDraft(value, initial, readScoreSettings(document));
    expect(reordered.conflicts.info).toBeUndefined();
    (document.score.meta["lxm:tonality"] as { data: { b: number[] } }).data.b.reverse();
    expect(initial.tonalityNamespace.namespaceRaw).toEqual({ version: 9, data: { a: 1, b: [2, 3] } });
    expect(reconcileSettingsDraft(value, initial, readScoreSettings(document)).conflicts.info).toBeTruthy();
  });
  it("旧 namespace 缺失与 null 不相同，提交前再次变更基线会拒绝且不写历史", () => {
    const { session, document, initial } = setup();
    const value = { ...initial, title: "我的输入" };
    const external = structuredClone(document);
    external.score.meta["lxm:tonality"] = null;
    const fresh = readScoreSettings(external);
    expect(reconcileSettingsDraft(value, initial, fresh).conflicts.info).toBeTruthy();
    expect(prepareSettingsSubmission(external, value, initial, undefined, "info")).toMatchObject({ ok: false, issue: { group: "info" } });
    expect(session.getState().historyDepth.past).toBe(0);
  });
  it("冲突后只改标题不能解除；显式认可整组重新验证关系，再次外部修改再次冲突", () => {
    const { document, initial } = setup();
    const value = changeScoreSettingsField({ ...initial, title: "我的名称" }, "tonalityIntent", { kind: "set", value: { version: 1, tonic: "A", mode: "minor", minorTonicDegree: 6 } });
    const external = structuredClone(document);
    external.score.arranger = "外部作者";
    external.score.keySignature = "D";
    const fresh = readScoreSettings(external);
    const conflicted = reconcileSettingsDraft(value, initial, fresh);
    const edited = changeScoreSettingsField(conflicted.value, "title", "再次编辑标题");
    expect(reconcileSettingsDraft(edited, conflicted.initial, fresh, conflicted.conflicts).conflicts.info).toBeTruthy();
    const invalid = acknowledgeScoreInfo(external, { ...edited, keySignature: "D" }, fresh);
    expect(invalid).toMatchObject({ ok: false, issue: { group: "info" } });
    const acknowledged = acknowledgeScoreInfo(external, edited, fresh);
    expect(acknowledged.ok).toBe(true);
    if (!acknowledged.ok) return;
    expect(acknowledged.value).toMatchObject({ title: "再次编辑标题", arranger: initial.arranger, keySignature: "C" });
    expect(prepareSettingsSubmission(external, acknowledged.value, acknowledged.initial, undefined, "info").ok).toBe(true);
    external.score.title = "又一次外部修改";
    const again = reconcileSettingsDraft(acknowledged.value, acknowledged.initial, readScoreSettings(external));
    expect(again.conflicts.info).toBeTruthy();
    expect(prepareSettingsSubmission(external, acknowledged.value, acknowledged.initial, undefined, "info").ok).toBe(false);
  });
  it("preserve 的未知资料不被标题修改覆盖，显式 delete 保留数字 1 并保留最新其他 meta", () => {
    const { session, document } = setup();
    document.score.meta["lxm:tonality"] = { version: 7, future: [1, 2] };
    session.getState().replaceDocument(document);
    const initial = readScoreSettings(session.getState().document!);
    const value = { ...initial, title: "只改标题" };
    let result = submitSettingsDraft({ getState: session.getState, commit: session.getState().execute, initial, value, group: "info" });
    expect(result.status).toBe("applied");
    expect(session.getState().document!.score.meta["lxm:tonality"]).toEqual({ version: 7, future: [1, 2] });
    const latest = readScoreSettings(session.getState().document!);
    result = submitSettingsDraft({ getState: session.getState, commit: session.getState().execute, initial: latest, value: { ...latest, tonalityIntent: { kind: "delete" } }, group: "info" });
    expect(result.status).toBe("applied");
    expect(session.getState().document!.score.meta).not.toHaveProperty("lxm:tonality");
    expect(session.getState().document!.score.keySignature).toBe(initial.keySignature);
  });
  it("等值 set 不是 dirty；无效/未知原资料变更后不能通过认可自动写回旧坏资料", () => {
    const { document } = setup();
    document.score.keySignature = "C";
    document.score.meta["lxm:tonality"] = { version: 1, tonic: "C", mode: "major" };
    const initial = readScoreSettings(document);
    const equal = changeScoreSettingsField(initial, "tonalityIntent", { kind: "set", value: { mode: "major", tonic: "C", version: 1 } });
    expect(isSettingsGroupDirty(equal, initial, "info")).toBe(false);
    document.score.meta["lxm:tonality"] = { version: 9, data: "旧资料" };
    const unknown = readScoreSettings(document);
    document.score.meta["lxm:tonality"] = { version: 10, data: "新资料" };
    expect(acknowledgeScoreInfo(document, { ...unknown, title: "草稿" }, readScoreSettings(document))).toMatchObject({ ok: false, issue: { group: "info" } });
  });
});
