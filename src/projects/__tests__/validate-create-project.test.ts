import { describe, expect, it } from "vitest";
import {
  isCreateProjectReady,
  parseCreateProjectBody,
  validateCreateProjectForm,
} from "@/projects/validate-create-project";

describe("create project form validation", () => {
  it("初始未选入口时未就绪", () => {
    expect(
      isCreateProjectReady({
        creationSource: null,
        name: "Demo",
        projectMode: "canvas",
        passwordEnabled: false,
        projectPassword: "",
        visualStyle: "live_action_cinematic",
      }),
    ).toBe(false);
  });

  it("选择创编故事后仍需名称与模式", () => {
    expect(
      isCreateProjectReady({
        creationSource: "story",
        name: "",
        projectMode: null,
        passwordEnabled: false,
        projectPassword: "",
        visualStyle: "live_action_cinematic",
      }),
    ).toBe(false);
  });

  it("选择上传剧本并填齐必填后就绪", () => {
    expect(
      isCreateProjectReady({
        creationSource: "script-upload",
        name: "  古城宣传片  ",
        projectMode: "full-stack",
        passwordEnabled: false,
        projectPassword: "",
        visualStyle: "three_d_animation",
      }),
    ).toBe(true);
  });

  it("项目名称为空时显示错误", () => {
    const errors = validateCreateProjectForm({
      creationSource: "story",
      name: "   ",
      projectMode: "canvas",
      passwordEnabled: false,
      projectPassword: "",
      highlights: "",
      visualStyle: "live_action_cinematic",
    });
    expect(errors.name).toBe("请输入项目名称");
  });

  it("密码未勾选时不要求填写", () => {
    const errors = validateCreateProjectForm({
      creationSource: "story",
      name: "A",
      projectMode: "canvas",
      passwordEnabled: false,
      projectPassword: "",
      highlights: "",
      visualStyle: "live_action_cinematic",
    });
    expect(errors.password).toBeUndefined();
    expect(
      isCreateProjectReady({
        creationSource: "story",
        name: "A",
        projectMode: "canvas",
        passwordEnabled: false,
        projectPassword: "",
        visualStyle: "live_action_cinematic",
      }),
    ).toBe(true);
  });

  it("密码勾选且为空时显示红色错误", () => {
    const errors = validateCreateProjectForm({
      creationSource: "story",
      name: "A",
      projectMode: "canvas",
      passwordEnabled: true,
      projectPassword: "",
      highlights: "",
      visualStyle: "live_action_cinematic",
    });
    expect(errors.password).toBe("已启用项目密码，请填写项目访问密码");
  });

  it("项目要点为空不阻止就绪", () => {
    expect(
      isCreateProjectReady({
        creationSource: "story",
        name: "A",
        projectMode: "canvas",
        passwordEnabled: false,
        projectPassword: "",
        visualStyle: "comic",
      }),
    ).toBe(true);
  });

  it("未选择模式时显示错误", () => {
    const errors = validateCreateProjectForm({
      creationSource: "story",
      name: "A",
      projectMode: null,
      passwordEnabled: false,
      projectPassword: "",
      highlights: "",
      visualStyle: "live_action_cinematic",
    });
    expect(errors.projectMode).toBe("请选择项目模式");
  });

  it("未选择生成风格时显示错误", () => {
    const errors = validateCreateProjectForm({
      creationSource: "story",
      name: "A",
      projectMode: "canvas",
      passwordEnabled: false,
      projectPassword: "",
      highlights: "",
      visualStyle: null,
    });
    expect(errors.visualStyle).toBe("请选择项目生成风格");
  });

  it("parseCreateProjectBody 拒绝无效入口并在勾选密码时要求密码", () => {
    expect(parseCreateProjectBody({ name: "x" }).ok).toBe(false);
    const ok = parseCreateProjectBody({
      name: "  Demo  ",
      creationSource: "story",
      projectMode: "canvas",
      passwordEnabled: true,
      projectPassword: "secret",
      highlights: "要点",
      visualStyle: "live_action_cinematic",
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.value.name).toBe("Demo");
      expect(ok.value.projectPassword).toBe("secret");
      expect(ok.value.visualStyle).toBe("live_action_cinematic");
    }

    const badPwd = parseCreateProjectBody({
      name: "Demo",
      creationSource: "story",
      projectMode: "canvas",
      passwordEnabled: true,
      projectPassword: "",
      visualStyle: "live_action_cinematic",
    });
    expect(badPwd.ok).toBe(false);
  });
});
