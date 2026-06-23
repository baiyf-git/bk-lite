# 模块 ARD：MLOps（机器学习生命周期）

> 路径 `server/apps/mlops` ｜ API 前缀 `api/v1/mlops/`

## 1. 职责【已实现/已存在】
管理 ML 数据集、训练任务、模型发布与服务；集成 MLflow 做实验跟踪。覆盖 6 类场景：异常检测、时序预测、日志聚类、分类、图像分类、目标检测。

## 2. 数据模型与存储【已实现/已存在】
每类场景含 **5 个场景实体**（类名带场景前缀，如 `AnomalyDetectionDataset`，见 `models/anomaly_detection.py:12,31,81,140,209`）+ 全局共享的 `AlgorithmConfig`：
| 实体 | 说明 |
|------|------|
| {Scenario}Dataset | 数据集容器（team 范围） |
| {Scenario}TrainData | 训练样本文件（存 MinIO `munchkin-public`，含 train/val/test 标记，`TrainDataFileCleanupMixin`） |
| {Scenario}TrainJob | 训练执行；实际字段为 `name/description/team/status/algorithm/dataset_version(FK→{Scenario}DatasetRelease)/hyperopt_config(JSONField,工作配置)/config_url(MinIO 归档备份)/max_evals`，**无 `mlflow_run_id`、无 `model_version`、无独立 `params` 字段**。MLflow 关联不存 run_id，而是按命名约定 `{prefix}_{algorithm}_{id}` 推算实验/模型名（`utils/mlflow_service.py:26-38`）【已实现/已存在】 |
| {Scenario}DatasetRelease | 版本化数据集快照（ZIP 存 MinIO） |
| {Scenario}Serving | 模型服务实例；实际字段为 `name/description/team/train_job(FK)/model_version/port/status/container_info(JSONField)`，**无 `serving_url` 字段**。推理地址不持久化，而在 predict 时由 `predict_url_builder.build_predict_url()` 按 `MLOPS_RUNTIME`（docker/kubernetes/主机模式）动态拼接（`predict_url_builder.py:19-41`）【已实现/已存在】 |
| AlgorithmConfig（`models/algorithm_config.py`，**全局共享，非按场景**） | 算法注册；字段 `algorithm_type`（6 选一，db_index）/`name`/`display_name`/`scenario_description`/`image`（训练与推理 Docker 镜像地址）/`form_config`/`is_active`（db_index）；`db_table=mlops_algorithm_config`，`unique_together=(algorithm_type,name)`；禁用或删除时若有训练任务在用会被阻止（`views/anomaly_detection.py:1480-1508`）【已实现/已存在】 |

> 共享行为由 `models/mixins.py` 提供（`TrainJobConfigSyncMixin`、`TrainDataFileCleanupMixin`）。

**TrainJob 配置同步（核心数据流）**【已实现/已存在】：`{Scenario}TrainJob` 同时继承 `DataPointFeaturesInfo` 混入，并以 `_model_prefix` 类属性供 `TrainJobConfigSyncMixin` 在 `save()` 时自动把 `hyperopt_config` 补全（注入顶层 `model`/`mlflow` 段，并把 `max_evals` 字段值写入 `hyperparams.max_evals`，模型标识为 `{_model_prefix}_{algorithm}_{id}`）并同步到 MinIO（写入 `config_url`）；该同步包裹在事务中，失败抛 `ConfigSyncError` 并回滚整笔保存（`models/anomaly_detection.py:140-148`、`models/mixins.py:118-242`）。

**存储**：PostgreSQL（ORM）；MinIO（训练数据/ZIP/配置备份/元数据）；MLflow（实验/指标/模型）。

## 3. 接口【已实现/已存在】
每场景注册 6 个 ViewSet：`{scenario}_{algorithm_configs,datasets,train_data,train_jobs,dataset_releases,servings}`（六场景共 36 个 ViewSet）。每个 ViewSet 除标准 CRUD 外还含大量 `@action` 自定义端点（远不止 36 个）：`TrainJob` 含 `train/stop/runs_data_list/runs/<id>(delete)/.../metrics_list/.../metrics_history/.../run_params/model_versions/.../download_model`；`Serving` 含 `start/stop/remove/predict`；`DatasetRelease` 含 `download/archive/unarchive`；`AlgorithmConfig` 含 `by_type/get_image`（`views/anomaly_detection.py:86,209,259,385,421,442,488,529,567,1127,1237,1274,1320,694,722,750,1510,1517`）。

### 3.1 在线推理（predict）请求规模上限约束【已实现/已存在】

`predict` 端点在转发请求给推理容器前，对入参体积执行前置校验，超限立即返回 `HTTP 413`：

| 场景类型 | 校验对象 | 默认上限 | 环境变量 |
|----------|----------|----------|----------|
| 异常检测 / 时序预测 / 日志聚类 / 文本分类 | 单次请求条数（列表长度） | 10,000 条 | `MLOPS_PREDICT_MAX_BATCH_SIZE` |
| 图片分类 / 目标检测 | 单次请求图片数量（列表长度） | 100 张 | `MLOPS_PREDICT_MAX_IMAGE_BATCH_SIZE` |
| 图片分类 / 目标检测 | 单张图片 base64 字节长度 | 10 MB（10,485,760 字节） | `MLOPS_PREDICT_MAX_IMAGE_BYTES` |

校验逻辑：先验证列表格式（非列表则返回 `400`），再按上表顺序依次校验；图片场景逐条遍历 base64 字符串长度，任一超限即拒绝。上限值可通过对应环境变量覆盖，默认值硬编码在各 ViewSet 的 `predict` action 中。

> 证据来源：`server/apps/mlops/views/anomaly_detection.py:1347`、`server/apps/mlops/views/timeseries_predict.py:1223`、`server/apps/mlops/views/log_clustering.py:1294`、`server/apps/mlops/views/classification.py:635`、`server/apps/mlops/views/image_classification.py:1360`、`server/apps/mlops/views/object_detection.py:1353`　|　同步基线：0fbb99c2　|　【已实现/已存在】

## 4. 依赖与通信【已实现/已存在】
- MLflow：`utils/mlflow_service.py`（实验/模型命名、client）。
- 容器编排（训练/推理）【已实现/已存在】：训练与推理容器经 `utils/webhook_client.py:WebhookClient` 调用 webhookd（`WEBHOOK_SERVER_URL`，缺失则禁用编排）拉起；支持 `docker` 与 `kubernetes` 两种 runtime（由 `MLOPS_RUNTIME` 选择，`webhook_client.py:72,86,164-168`）。训练镜像来自 `AlgorithmConfig.image`（`get_image_by_prefix`）。训练由 `WebhookClient.train`（`views/anomaly_detection.py:163-173`）触发，发布由 `WebhookClient.serve`（`views/anomaly_detection.py:953-959`）触发。
- Celery 任务【已实现/已存在】：
  - `tasks/base.py:mark_release_as_failed`。
  - `tasks/poll_train_job_status.py:poll_train_job_status`（`shared_task`，函数名无 `mlflow` 前缀，`__init__` 同名导出；轮询 MLflow run 状态同步 TrainJob，`tasks/__init__.py:23,32`）。
  - 每场景各一个数据集发布异步任务 `publish_dataset_release_async`（共 6 个，按场景在 `tasks/__init__.py:5-22` 以场景前缀导出），通用逻辑在 `tasks/base.py:publish_dataset_release_base`（下载 train/val/test → 统计样本数 → 生成元数据 → 打 ZIP → 上传 MinIO → 更新发布记录，`tasks/base.py:188-344`）。MinIO 文件下载与样本计数均改为按块流式处理（`count_samples` 回调签名由 `bytes` 改为本地文件 `Path`，逐块读取避免整文件入内存；块大小默认 64 KB，可由环境变量 `MLOPS_STREAM_CHUNK_SIZE` 覆盖，`tasks/base.py:81,110-135,266-284`）。
- Django Signal 资源清理【已实现/已存在】：`signals/base.py:register_cleanup_signals` 在 app `ready()`（`apps.py` 导入 `apps.mlops.signals`）时为每场景注册 5 类 `post_delete` 信号：数据集发布文件清理、训练数据文件清理、训练任务 config 文件清理、MLflow 实验/模型清理、Serving 容器清理（`WebhookClient.remove`，`signals/base.py:26-86,302-370`）。
- NATS【已实现/已存在】：`nats_api.py` 注册两个 handler：`get_mlops_module_list`（返回模块/子模块树，`nats_api.py:171-187`）与 `get_mlops_module_data`（按 `group_id` 分页取 `id/name` 列表，`nats_api.py:190-212`）；顶层 `MODULE_DISPLAY_NAMES` 仅含 `dataset/train_job/serving` 三个模块（`nats_api.py:121-125`）。映射区分 `ROOT_MODULE_MODEL_MAP`（根团队对象）与 `INHERITED_MODULE_MODEL_MAP`（经 FK 如 `dataset__team` 继承的嵌套权限，`nats_api.py:49-115`）。`get_mlops_module_data` 入参做了健壮性收敛：未知 `module`/`child_module` 返回 `{"result": False, "message": ...}`，`page_size` 被钳制在 `[1, MAX_PAGE_SIZE]`（`MAX_PAGE_SIZE` 默认 500，可由环境变量 `MLOPS_NATS_MAX_PAGE_SIZE` 覆盖），成功响应统一带 `"result": True` 信封（`nats_api.py:118,194-202,212`）。
- 关键环境变量依赖【已实现/已存在】：`WEBHOOK_SERVER_URL`（webhookd 地址，缺失则禁用容器编排）、`MLOPS_RUNTIME`（docker/kubernetes）、`MLOPS_KUBERNETES_NAMESPACE`、`MLOPS_DOCKER_NETWORK`、`DEFAULT_ZONE_VAR_NODE_SERVER_URL`（主机模式推理地址）、`MLFLOW_TRACKER_URL`、`MLFLOW_S3_ENDPOINT_URL`、`MINIO_ACCESS_KEY`、`MINIO_SECRET_KEY`（`webhook_client.py:72,86,164-168`、`predict_url_builder.py:11,23,30`、`services/config_helpers.py:40-43,97`）；`MLOPS_PREDICT_MAX_BATCH_SIZE`（文本/数据类 predict 批量上限，默认 10000，`views/anomaly_detection.py:1347`）、`MLOPS_PREDICT_MAX_IMAGE_BATCH_SIZE`（图片类 predict 张数上限，默认 100，`views/image_classification.py:1360`）、`MLOPS_PREDICT_MAX_IMAGE_BYTES`（图片类 predict 单张 base64 字节上限，默认 10 MB，`views/image_classification.py:1366`）【已实现/已存在】。

- 组织上下文解析【已实现/已存在】：六场景 serializer 的跨对象归属校验（`assert_team_ownership`，校验 `dataset`/`train_job` 是否属于当前组织）经 `utils/group_scope.py:get_current_team` 取当前组织 id。该函数改为委托 `apps.core.utils.team_utils.get_current_team`，按「API-Key 中间件注入的 `request._api_current_team` → 浏览器 `current_team` cookie」优先级解析，使 API-Key 调用方与浏览器调用方走同一组织上下文读取路径（先前仅读 cookie，API-Key 场景拿不到组织）（`utils/group_scope.py:20-39`、`apps/core/utils/team_utils.py:get_current_team`）。

## 5. 风险 / 待确认
- 推理/训练容器编排已明确：经 webhookd 拉起 docker/k8s 容器，镜像由 `AlgorithmConfig` 指定（详见 §4），非平台固定用 BentoML 打包。`algorithms/` 中的 BentoML 服务仅为算法侧推理实现框架。

## 6. 证据来源
`server/apps/mlops/{urls.py,models/*,models/mixins.py,models/algorithm_config.py,utils/mlflow_service.py,utils/webhook_client.py,predict_url_builder.py,services/config_helpers.py,tasks/*,signals/base.py,nats_api.py,apps.py,views/anomaly_detection.py,views/timeseries_predict.py,views/log_clustering.py,views/classification.py,views/image_classification.py,views/object_detection.py}`、`config/components/mlflow.py`。
