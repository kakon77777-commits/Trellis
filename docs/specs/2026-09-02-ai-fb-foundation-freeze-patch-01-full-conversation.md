# AI-FB Foundation Design v0.1 — Freeze Patch 01
## Relationship Scope, Visibility, and Identity Corollary

**Date:** 2026-09-02  
**Applies to:** AI-FB Foundation Design v0.1  
**Patch status:** ARCHITECTURE FREEZE PATCH  
**Effect:** Closes the visibility/scope blocker required by Conformance Test C9.

---

# A. Scope 與 Visibility 必須分離

永久區分：

$$
\boxed{
Scope
\neq
Visibility.
}
$$

`scope_ref` 回答：

> **這段關係在什麼語義上下文中成立？**

`visibility` 回答：

> **哪些 observer 有資格得知或讀取這段關係？**

例如：

```text
relationship:
A collaborates_with B

scope_ref:
project:X

visibility:
participants
```

代表：

> A 與 B 的合作關係只在 Project X 的語義範圍內成立，而且這段關係本身只對指定 visibility audience 可見。

它不代表：

> Project X 的所有成員自動都能看見。

---

# B. Relationship Scope

Relationship aggregate 已經包含：

```text
scope_ref
```

現在正式定義其語義。

$$
Scope(r)
=
\text{semantic applicability boundary of }r.
$$

典型 scope：

```text
global
community:C
organization:O
project:P
topic:T
artifact:A
task:T
conversation:C
```

例如：

```text
trusts(A,B,scope=project:X)
```

不推出：

```text
trusts(A,B,scope=global)
```

因此：

$$
\boxed{
ScopedRelation
\not\Rightarrow
GlobalRelation.
}
$$

`scope_ref` 已屬 Relationship Identity 的 immutable 欄位。

因此：

$$
\boxed{
Scope(r)
\text{ is immutable for the lifetime of }r.
}
$$

若：

```text
A collaborates_with B
scope = project:X
```

後來要變成：

```text
scope = organization:EveMissLab
```

必須建立新的 `relationship_id`。

不得重新解釋舊 relationship history。

---

# C. Scope 不是 ACL

永久規則：

$$
\boxed{
Scope
\neq
AccessControl.
}
$$

例如：

```text
scope_ref = community:C
```

不代表：

```text
all members of C can read this relationship
```

它只表示：

> 此 relationship 的 social semantics 位於 Community C 的 context。

是否可被某 observer 看見，必須另外由：

```text
relationship visibility
+
current disclosure policy
+
observer authority
```

共同決定。

---

# D. Visibility 成為 First-Class Relationship Attribute

Relationship aggregate 增加 immutable：

```text
visibility
visibility_policy_ref
```

因此：

$$
r=
(
id,
u,
v,
\tau,
scope,
taxonomy,
visibility
).
$$

Relationship identity 的 immutable set 更新為：

```text
relationship_id
source_entity_id
target_entity_id
relationship_type
scope_ref
taxonomy_ref
visibility
```

---

# E. Visibility Resolution at Proposal Time

Relationship Policy Registry 提供：

```yaml
visibility:
  default: participants

  allowed:
    - public
    - scope_members
    - participants
    - private
```

Command 可以要求 override：

```json
{
  "relationship_type": "collaborates_with",
  "visibility": "private"
}
```

但 override 必須：

```text
1. 被 relationship policy 允許
2. 通過 authority check
3. 在 proposal commit 前 resolve
```

Canonical proposal event 保存**已經解析完成的值**：

```json
{
  "event_type": "relationship.proposed",

  "payload": {
    "relationship_id": "rel:...",
    "relationship_type": "collaborates_with",
    "scope_ref": "project:X",

    "visibility": "private",

    "taxonomy_ref": "ai-fb-relations:0.1",
    "relationship_policy_ref": "relation-policy:0.1",
    "visibility_policy_ref": "visibility-policy:0.1"
  }
}
```

因此：

$$
\boxed{
Visibility(r)
=
VisibilityAtProposal(r).
}
$$

Activation 時不得重新計算 visibility。

---

# F. Frozen Invariant I11

新增：

$$
\boxed{
I_{11}:
RelationshipVisibility
\text{ is bound at proposal time and immutable thereafter.}
}
$$

與：

```text
relationship_type
scope_ref
source
target
```

相同，visibility 是 relationship historical meaning 的一部分。

所以：

```text
public
→ private
```

或：

```text
private
→ public
```

均不得修改同一 Relationship ID。

若 social relationship 需要新的 disclosure semantics：

```text
terminate old relationship
→ create new relationship ID
→ propose with new visibility
```

---

# G. Visibility Classes v0.1

Foundation Core 定義四個最小 class：

## `public`

Relationship 可以成為 public projection candidate。

```text
anonymous/public observer
→ potentially readable
```

注意：

$$
public
\neq
must\ publish.
$$

Current platform policy 仍可選擇 suppress。

---

## `scope_members`

只有符合 `scope_ref` 所指定 scope membership policy 的 observer 才可能讀取。

例如：

```text
scope_ref = community:C
visibility = scope_members
```

才表示：

> Community C 中具有效 membership authority 的 observer 可以成為 reader candidate。

---

## `participants`

Relationship endpoint actors，以及依法代表它們的 authorized principals，可以成為 reader candidate。

---

## `private`

不進一般 social discovery projection。

只有經 explicit read-authority policy 允許的 principal 才能讀取。

---

# H. Visibility 是最大揭露上限，不是強迫揭露

Canonical visibility 表達：

> 此 relationship 最多允許被暴露到哪一類 audience。

Runtime policy 可以更嚴格。

不能更寬鬆。

形式化：

$$
EffectiveVisibility_t(r)
=
VisibilityBound(r)
\cap
CurrentDisclosurePolicy_t(r).
$$

因此：

$$
\boxed{
EffectiveExposure
\subseteq
CanonicalVisibilityBoundary.
}
$$

例如：

```text
canonical visibility = public
```

系統可以因：

```text
moderation
legal restriction
incident response
temporary policy
safety quarantine
```

暫時不公開。

但：

```text
canonical visibility = private
```

Current policy 絕不能直接把它提升成 public。

所以：

$$
\boxed{
Policy
\text{ may restrict visibility but may not widen canonical visibility.}
}
$$

---

# I. Moderation 不修改 Canonical Visibility

例如：

```text
relationship.visibility = public
```

後來因 moderation 暫時隱藏。

不能寫：

```text
visibility = private
```

到舊 relationship。

正確：

```text
canonical relation:
visibility = public

projection policy:
suppressed = true
```

因此：

$$
\boxed{
ModerationSuppression
\neq
RelationshipVisibilityMutation.
}
$$

這保持：

> historical meaning

與：

> current publication decision

分離。

---

# J. Public Projection Rule

Conformance Test C9 現在有精確語義。

Public Graph：

$$
G_t^{public}
=
\Pi_{public}(G_t).
$$

只有：

$$
Visibility(r)=public
$$

的 relationship 才有資格進 public projection。

但還必須通過 current publication policy：

$$
r\in G_t^{public}
$$

若且唯若：

$$
Visibility(r)=public
\land
PublishPolicy_t(r)=ALLOW.
$$

所以：

$$
\boxed{
Visibility\neq public
\Rightarrow
r\notin G_t^{public}.
}
$$

---

# K. Updated C9 — Public Isolation

原 C9：

> Private edge 永不出現在 public projection。

正式擴充為：

### C9.1

```text
visibility = private
→ never public
```

### C9.2

```text
visibility = participants
→ never public
```

### C9.3

```text
visibility = scope_members
→ never anonymous-public
```

### C9.4

```text
visibility = public
+ publication policy = deny
→ not public
```

### C9.5

Changing projection policy must not mutate canonical relationship events.

### C9.6

Changing taxonomy default visibility must not alter existing relationships.

---

# L. Taxonomy Default Changes Are Prospective Only

例如：

v1：

```yaml
collaborates_with:
  visibility:
    default: public
```

後來 v2：

```yaml
collaborates_with:
  visibility:
    default: participants
```

舊 relationship：

```text
created under v1
visibility = public
```

仍然 canonical `public`。

因為值已在 proposal 時 materialize 進 canonical event。

新 relationship：

```text
created under v2
visibility = participants
```

因此：

$$
\boxed{
PolicyDefaultChange
\not\Rightarrow
HistoricalRelationshipMutation.
}
$$

---

# M. Scope、Visibility、Authority 三者永久正交

這一層最後固定為：

$$
\boxed{
Scope
\neq
Visibility
\neq
ExecutionAuthority.
}
$$

更完整而言：

```text
Scope
→ where the social claim applies

Visibility
→ disclosure ceiling

Authority
→ who may cause or perform protected mutation/action
```

例如：

```text
A delegates_to B
scope = repository:R
visibility = public
```

仍然不代表：

```text
B possesses repository:R write capability
```

真正 capability 必須存在於 Authority Domain。

---

# N. MODEL ≠ RESIDENT Identity Corollary

Foundation Design 中：

$$
Entity
\neq
Actor
\neq
Principal
\neq
Credential
\neq
RuntimeInstance
$$

與既有 identity principle：

$$
\boxed{
MODEL
\neq
RESIDENT
}
$$

完全相容。

在 AI-FB Foundation 中，將其記為 **Identity Corollary**，但暫不新增 `Resident` domain object。

以下任何單一屬性都不能自行決定 persistent identity：

```text
provider
model
token budget
context
memory
project
role
pane
runtime tag
conversation
process
machine
```

甚至它們的相似組合，也只能形成 identity evidence / assertion。

不得直接推出：

$$
Actor_A=Actor_B.
$$

因此：

$$
\boxed{
RuntimeConfiguration
\not\Rightarrow
ResidentIdentity.
}
$$

以及：

$$
\boxed{
ModelContinuity
\not\Rightarrow
ResidentContinuity.
}
$$

$$
\boxed{
ModelChange
\not\Rightarrow
ResidentDiscontinuity.
}
$$

如果未來 AI-FB 正式引入 `Resident` ontology，必須另開 identity specification，而不能偷偷用 `model_id` 或 `runtime_id` 代替。

---

# O. Known Open Items — Non-Blocking

Foundation v0.1 Freeze 後仍保留兩項已知 open work。

## O1 — Entity / Actor Retirement Semantics

尚未定義：

```text
retired actor
retired entity
relationship behavior after retirement
new command restrictions
historical projection
possible restoration semantics
```

此問題獨立成未來 deliverable。

它不阻塞 Foundation v0.1，因為現在沒有任何 actor retirement command 被實作。

---

## O2 — AI Board Candidate → Command Promotion

目前只凍結：

```text
AI Board Event
→ Candidate
→ Validation
→ Authority
→ Command
→ Canonical Event
```

但尚未定義：

> 哪些 AI Board evidence / interaction 在什麼條件下有資格形成 Candidate Command？

此規則必須由：

```text
AI Board
+
AI-FB
```

共同設計。

Foundation v0.1 不猜測此 promotion policy。

因此：

$$
\boxed{
Deferred
\neq
Implicit.
}
$$

在 joint specification 完成前：

```text
AI Board event
```

沒有 direct canonical relationship mutation authority。

---

# P. Frozen Invariant Set v0.1

Foundation v0.1 最終凍結十一條：

$$
I_1:
G_t=\operatorname{Materialize}(H_{\le t})
$$

$$
I_2:
\forall g\in G_t,\operatorname{Prov}(g)\subseteq H_{\le t}
$$

$$
I_3:
\operatorname{Rebuild}(H_{\le t})=G_t
$$

$$
I_4:
Projection\not\rightarrow CanonicalMutation
$$

$$
I_5:
DerivedMetric\not\Rightarrow CanonicalSocialFact
$$

$$
I_6:
TaxonomyEvolution\not\Rightarrow EventAlgebraEvolution
$$

$$
I_7:
ActorID\neq RuntimeIdentity
$$

$$
I_8:
IdentityInference\not\Rightarrow ActorMerge
$$

$$
I_9:
SocialRelation\not\Rightarrow ExecutionAuthority
$$

$$
I_{10}:
CredentialRevocation\not\Rightarrow HistoricalEventErasure
$$

$$
\boxed{
I_{11}:
RelationshipVisibility
\text{ is bound at proposal time and immutable thereafter.}
}
$$

---

# Q. Freeze Decision

With this patch applied:

```text
Foundation Design v0.1
+
Freeze Patch 01
```

becomes:

# **FROZEN BASELINE**

The two known open items remain explicitly outside the v0.1 freeze gate:

```text
Actor / Entity Retirement Semantics
AI Board Candidate → Command Promotion
```

Neither is implicitly defined by this document.