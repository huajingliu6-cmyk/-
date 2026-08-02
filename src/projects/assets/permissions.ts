/**
 * 资产编辑权限。
 * 默认：项目主理人可编辑。
 * 后续团队协作可扩展成员角色，不要硬编码用户名。
 */
export function canEditAsset(input: {
  isProjectOwner: boolean;
  /** 后续：协作成员是否具备资产编辑权 */
  memberCanEdit?: boolean;
}): boolean {
  if (input.isProjectOwner) return true;
  return Boolean(input.memberCanEdit);
}
