import argparse
import builtins
import io
import json
import os
import sqlite3
import sys
import time


def _configure_stdio():
    if hasattr(sys.stdin, "reconfigure"):
        sys.stdin.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    else:
        sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding="utf-8", errors="replace")
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")


_configure_stdio()


def print(*args, **kwargs):
    kwargs.setdefault("file", sys.stderr)
    kwargs.setdefault("flush", True)
    return builtins.print(*args, **kwargs)


if not os.environ.get("HF_ENDPOINT"):
    os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")


BUILTIN_AI_VOCABULARY = {
    "scene": [
        "雪山", "草原", "森林", "松林", "湖泊", "河流", "溪流", "峡谷", "山谷", "冰川",
        "雪原", "云海", "日出", "日落", "晚霞", "夜景", "星空", "海边", "沙漠", "湿地",
        "花海", "田野", "村庄", "古镇", "寺庙", "桥梁", "城市天际线", "城市街景", "高山",
        "山脉", "公路", "热气球"
    ],
    "location": [
        "北京", "上海", "广州", "深圳", "成都", "重庆", "杭州", "西安", "武汉", "南京",
        "苏州", "青岛", "拉萨", "乌鲁木齐", "昆明", "大理", "丽江", "哈尔滨", "香港", "澳门",
        "西藏", "新疆", "云南", "四川", "青海", "内蒙古"
    ],
    "animal": [
        "马", "牛", "羊", "牦牛", "鹿", "骆驼", "狗", "猫", "熊", "棕熊", "老虎", "鸟", "鹰",
        "天鹅", "丹顶鹤", "熊猫", "狐狸", "狼"
    ],
    "people": [
        "人物", "单人", "合照", "男性", "女性", "儿童", "背影", "侧脸"
    ],
    "device": [
        "相机", "无人机", "汽车", "巴士", "火车", "飞机", "自行车", "摩托车"
    ],
    "event": [
        "婚礼", "演出", "节庆", "运动", "徒步", "露营", "骑行"
    ],
    "color": [
        "天空蓝", "湖水青", "冰湖蓝", "山影蓝", "松林绿", "草甸绿", "草木绿", "苔原绿",
        "雪峰白", "云雾白", "雾霭灰", "岩壁灰", "夜幕黑", "暖阳橙", "晨光橙", "落日金",
        "琥珀金", "沙丘棕", "岩壁棕", "暮云紫", "霞雾紫"
    ],
}

TEXT_PROMPT_TEMPLATES = {
    "default": [
        "{name}",
        "一张{name}的照片",
        "画面中有{name}",
        "a photo of {name}",
        "the main subject is {name}",
    ],
    "scene": [
        "{name}",
        "一张{name}风景照",
        "旅行风光中的{name}",
        "a scenic photo of {name}",
        "the scene is {name}",
    ],
    "season": [
        "{name}",
        "一张{name}旅行风景照片",
        "画面呈现{name}的自然景色",
        "a travel photo in {name}",
        "the season looks like {name}",
    ],
    "location": [
        "{name}",
        "拍摄于{name}的旅游照片",
        "这张图的地点是{name}",
        "a travel photo taken in {name}",
        "the location is {name}",
    ],
    "animal": [
        "{name}",
        "一张{name}的动物照片",
        "自然风景里有{name}",
        "a photo of the animal {name}",
        "{name} in a natural landscape",
    ],
    "people": [
        "{name}",
        "照片里有人物",
        "旅行场景中的{name}",
        "a travel photo with people",
        "the image contains {name}",
    ],
    "device": [
        "{name}",
        "照片里有{name}",
        "旅游装备或交通工具{name}",
        "a photo containing {name}",
        "the image clearly shows {name}",
    ],
    "event": [
        "{name}",
        "一张{name}活动照片",
        "旅游活动场景中的{name}",
        "a photo of the event {name}",
        "the image records {name}",
    ],
    "color": [
        "{name}",
        "画面主色调是{name}",
        "the dominant color is {name}",
        "the most visible color is {name}",
    ],
}

PROMPT_NAME_VARIANTS = {
    "热气球": ["热气球", "彩色热气球", "hot air balloon"],
    "草原": ["草原", "大草原", "grassland", "prairie"],
    "雪山": ["雪山", "雪山风景", "snow mountain"],
    "森林": ["森林", "树林", "forest"],
    "湖泊": ["湖泊", "湖景", "lake"],
    "新疆": ["新疆", "新疆草原", "Xinjiang", "Xinjiang grassland"],
    "人物": ["人物", "游客", "portrait", "person", "people"],
    "女性": ["女性", "单人女性", "年轻女性", "girl", "woman", "female"],
    "男性": ["男性", "单人男性", "man", "male"],
    "单人": ["单人", "一个人", "single person", "solo traveler"],
    "多人": ["多人", "一群人", "group photo", "crowd"],
    "河流": ["河流", "河道", "river"],
    "人物": ["人物", "游客", "person", "people"],
    "单人": ["单人", "一个人", "single person"],
    "合照": ["合照", "多人合影", "group photo"],
    "马": ["马", "一匹马", "horse"],
    "牛": ["牛", "cow", "cattle"],
    "羊": ["羊", "绵羊", "sheep"],
    "骆驼": ["骆驼", "camel"],
    "狗": ["狗", "pet dog", "dog"],
    "猫": ["猫", "pet cat", "cat"],
    "熊": ["熊", "bear", "wild bear"],
    "棕熊": ["棕熊", "brown bear"],
    "老虎": ["老虎", "虎", "tiger"],
    "鸟": ["鸟", "bird"],
    "相机": ["相机", "照相机", "camera"],
    "无人机": ["无人机", "drone", "uav"],
    "汽车": ["汽车", "小汽车", "car"],
    "巴士": ["巴士", "大巴车", "bus"],
    "火车": ["火车", "列车", "train"],
    "飞机": ["飞机", "airplane", "aircraft"],
    "自行车": ["自行车", "骑行自行车", "bicycle"],
    "摩托车": ["摩托车", "motorcycle"],
    "婚礼": ["婚礼", "婚礼现场", "wedding"],
    "演出": ["演出", "舞台演出", "performance"],
    "节庆": ["节庆", "庆典活动", "festival"],
    "运动": ["运动", "体育比赛", "sports"],
    "徒步": ["徒步", "户外徒步", "hiking"],
    "露营": ["露营", "户外露营", "camping"],
    "骑行": ["骑行", "自行车骑行", "cycling"],
    "天安门": ["天安门", "天安门城楼", "天安门广场", "Tiananmen", "Tiananmen Square", "Gate of Heavenly Peace"],
    "故宫": ["故宫", "故宫博物院", "紫禁城", "Forbidden City", "The Forbidden City"],
    "外滩": ["外滩", "上海外滩", "The Bund", "Shanghai Bund", "Waitan"],
    "东方明珠": ["东方明珠", "东方明珠塔", "Oriental Pearl", "Oriental Pearl Tower"],
    "布达拉宫": ["布达拉宫", "布达拉宫广场", "Potala Palace"],
    "洪崖洞": ["洪崖洞", "Hongyadong", "Hongya Cave"],
    "西湖": ["西湖", "杭州西湖", "West Lake", "Xihu"],
    "滇池": ["滇池", "滇池风景区", "Dianchi", "Dianchi Lake"],
    "大昭寺": ["大昭寺", "大昭寺广场", "Jokhang Temple"],
    "\u6625\u5929": ["\u6625\u5929", "\u6625\u65e5\u751f\u673a", "\u5ae9\u7eff\u65b0\u82bd", "spring"],
    "\u590f\u5929": ["\u590f\u5929", "\u76db\u590f\u70c8\u65e5", "\u7eff\u6811\u6210\u836b", "summer"],
    "\u79cb\u5929": ["\u79cb\u5929", "\u91d1\u79cb\u843d\u53f6", "\u5c42\u6797\u5c3d\u67d3", "autumn"],
    "\u51ac\u5929": ["\u51ac\u5929", "\u51db\u51ac\u51b0\u96ea", "\u767d\u96ea\u7688\u7688", "winter"],
}

CATEGORY_RESULT_LIMITS = {
    "scene": 6,
    "location": 4,
    "animal": 4,
    "people": 5,
    "device": 4,
    "event": 4,
    "color": 2,
}

CATEGORY_RESULT_THRESHOLDS = {
    "scene": 0.07,
    "location": 0.1,
    "animal": 0.08,
    "people": 0.08,
    "device": 0.08,
    "event": 0.08,
    "color": 0.18,
}

WEATHER_PROMPT_GROUPS = {
    "\u6674\u5929": [
        "\u4e00\u5f20\u9633\u5149\u660e\u5a9a\u3001\u5149\u7ebf\u5145\u8db3\u3001\u6709\u6e05\u6670\u5149\u5f71\u548c\u660e\u4eae\u5929\u7a7a\u7684\u6237\u5916\u7167\u7247\u3002",
        "\u6237\u5916\u6674\u6717\u84dd\u5929\u3001\u5149\u7ebf\u660e\u4eae\u7684\u65c5\u6e38\u98ce\u666f\u7167\u7247\u3002",
        "a bright outdoor photo with clear sunlight and visible shadows",
    ],
    "\u9634\u5929": [
        "\u4e00\u5f20\u5149\u7ebf\u6697\u6de1\u3001\u5929\u7a7a\u7070\u8499\u8499\u3001\u6ca1\u6709\u660e\u663e\u9633\u5149\u7684\u9634\u5929\u6237\u5916\u7167\u7247\u3002",
        "\u9634\u4e91\u5bc6\u5e03\u3001\u5149\u5f71\u67d4\u548c\u3001\u6574\u4f53\u504f\u7070\u7684\u6237\u5916\u7167\u7247\u3002",
        "an overcast outdoor photo with soft light and a gray sky",
    ],
    "\u96e8\u5929": [
        "\u4e00\u5f20\u4e0b\u96e8\u5929\u6c14\u3001\u8def\u9762\u6f6e\u6e7f\u3001\u5929\u7a7a\u9634\u6c89\u7684\u6237\u5916\u7167\u7247\u3002",
        "\u96e8\u5e55\u3001\u96e8\u4f1e\u3001\u6e7f\u6f09\u5730\u9762\u548c\u7070\u6697\u5149\u7ebf\u7684\u65c5\u6e38\u7167\u7247\u3002",
        "a rainy outdoor photo with wet ground and visible rain clouds",
    ],
    "\u96ea\u5929": [
        "\u4e00\u5f20\u4e0b\u96ea\u6216\u79ef\u96ea\u8986\u76d6\u7684\u51ac\u65e5\u6237\u5916\u7167\u7247\u3002",
        "\u767d\u96ea\u76d6\u5730\u3001\u51b0\u51b7\u5929\u7a7a\u3001\u5bd2\u51b7\u6c14\u6c1b\u7684\u65c5\u6e38\u7167\u7247\u3002",
        "a snowy outdoor photo with snow-covered ground or falling snow",
    ],
    "\u96fe\u5929": [
        "\u4e00\u5f20\u6709\u96fe\u6c14\u3001\u80fd\u89c1\u5ea6\u4f4e\u3001\u753b\u9762\u6709\u96fe\u972d\u7684\u6237\u5916\u7167\u7247\u3002",
        "\u4e91\u96fe\u7f2d\u7ed5\u3001\u7070\u767d\u8c03\u3001\u89c6\u7ebf\u673a\u80fd\u88ab\u96fe\u906e\u6321\u7684\u98ce\u666f\u7167\u7247\u3002",
        "a foggy outdoor photo with mist and reduced visibility",
    ],
}

WEATHER_THRESHOLD = 0.22
WEATHER_MARGIN = 0.03

ENHANCED_AI_VOCABULARY = {
    "scene": BUILTIN_AI_VOCABULARY["scene"] + ["自然", "风景"],
    "location": BUILTIN_AI_VOCABULARY["location"] + [
        "外滩", "东方明珠", "天安门", "故宫", "布达拉宫", "洪崖洞", "西湖", "滇池", "大昭寺",
        "天安门广场", "天安门城楼", "故宫博物院", "紫禁城", "上海外滩", "东方明珠塔", "布达拉宫广场", "滇池风景区",
    ],
    "animal": BUILTIN_AI_VOCABULARY["animal"],
    "people": BUILTIN_AI_VOCABULARY["people"],
    "device": BUILTIN_AI_VOCABULARY["device"],
    "event": BUILTIN_AI_VOCABULARY["event"],
    "color": BUILTIN_AI_VOCABULARY["color"],
}


def _write(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _read():
    line = sys.stdin.readline()
    if not line:
        return None
    return json.loads(line)


class Engine:
    def __init__(self, db_path, model_name):
        self.db_path = db_path
        self.model_name = model_name
        self.enabled = False
        self.device = "cpu"
        self.vector_dim = 512

        self._tag_names = []
        self._tag_features = None
        self._tag_category_names = {}
        self._tag_category_features = {}
        self._weather_labels = []
        self._weather_features = None

        self._faiss = None
        self._index = None
        self._index_image_ids = []

        self._torch = None
        self._np = None
        self._Image = None
        self._ChineseCLIPProcessor = None
        self._ChineseCLIPModel = None
        self._model = None
        self._processor = None
        self._mediapipe = None
        self._face_detector = None
        self._cv2 = None
        self._person_hog = None

        self._try_init()

    def _try_init(self):
        try:
            import numpy as np
            import torch
            import faiss
            from PIL import Image
            from transformers import ChineseCLIPModel, ChineseCLIPProcessor
            from huggingface_hub import hf_hub_download

            self._np = np
            self._torch = torch
            self._faiss = faiss
            self._Image = Image
            self._ChineseCLIPProcessor = ChineseCLIPProcessor
            self._ChineseCLIPModel = ChineseCLIPModel
            try:
                import mediapipe as mp
                self._mediapipe = mp
            except Exception as error:
                print(f"[AI] MediaPipe unavailable: {error}")
                self._mediapipe = None
            try:
                import cv2
                self._cv2 = cv2
            except Exception as error:
                print(f"[AI] OpenCV unavailable: {error}")
                self._cv2 = None

            self.device = "cuda" if torch.cuda.is_available() else "cpu"
            print(f"[AI] 设备: {self.device}")
            print(f"[AI] 正在加载 Chinese-CLIP 模型 ({self.model_name})...")

            try:
                model_file = None
                for candidate in ["model.safetensors", "pytorch_model.bin"]:
                    try:
                        model_file = hf_hub_download(
                            repo_id=self.model_name,
                            filename=candidate,
                            local_files_only=True,
                        )
                        break
                    except Exception:
                        pass
                if model_file:
                    size_mb = os.path.getsize(model_file) / (1024 * 1024)
                    print(f"[AI] 本地模型文件: {size_mb:.1f} MB")
                else:
                    print("[AI] 未找到本地缓存，将尝试联网下载")
            except Exception as error:
                print(f"[AI] 本地模型检查跳过: {error}")

            loaded = False
            for local_only in (True, False):
                try:
                    self._model = ChineseCLIPModel.from_pretrained(
                        self.model_name,
                        local_files_only=local_only,
                    ).to(self.device)
                    self._processor = ChineseCLIPProcessor.from_pretrained(
                        self.model_name,
                        local_files_only=local_only,
                    )
                    loaded = True
                    print(f"[AI] 模型加载成功 (local_only={local_only})")
                    break
                except Exception as error:
                    if local_only:
                        print(f"[AI] 本地加载失败，尝试联网: {error}")
                    else:
                        raise

            if not loaded:
                raise RuntimeError("模型加载失败")

            self._index = faiss.IndexFlatIP(self.vector_dim)
            if self._mediapipe is not None:
                try:
                    self._face_detector = self._mediapipe.solutions.face_detection.FaceDetection(
                        model_selection=0,
                        min_detection_confidence=0.45,
                    )
                    print("[AI] MediaPipe face detection ready")
                except Exception as error:
                    print(f"[AI] MediaPipe face detector init failed: {error}")
                    self._face_detector = None
            if self._cv2 is not None:
                try:
                    self._person_hog = self._cv2.HOGDescriptor()
                    self._person_hog.setSVMDetector(self._cv2.HOGDescriptor_getDefaultPeopleDetector())
                    print("[AI] OpenCV people detector ready")
                except Exception as error:
                    print(f"[AI] OpenCV people detector init failed: {error}")
                    self._person_hog = None
            self.enabled = True
            self.reload_tags()
        except Exception as error:
            print(f"[AI] 初始化失败: {error}")
            import traceback
            traceback.print_exc()
            self.enabled = False

    def _connect(self):
        return sqlite3.connect(self.db_path)

    def _merge_tag_groups(self, db_tag_rows):
        merged = {}
        seen = set()

        for vocabulary in (BUILTIN_AI_VOCABULARY, ENHANCED_AI_VOCABULARY):
            for category, names in vocabulary.items():
                bucket = merged.setdefault(category, [])
                for name in names:
                    key = (category, name)
                    if name and key not in seen:
                        seen.add(key)
                        bucket.append(name)

        for category_id, name in db_tag_rows:
            category = category_id or "custom"
            bucket = merged.setdefault(category, [])
            key = (category, name)
            if name and key not in seen:
                seen.add(key)
                bucket.append(name)

        return merged

    def _build_prompt_texts(self, name, category="default"):
        season_names = {"\u6625\u5929", "\u590f\u5929", "\u79cb\u5929", "\u51ac\u5929"}
        templates = TEXT_PROMPT_TEMPLATES["season"] if name in season_names else (TEXT_PROMPT_TEMPLATES.get(category) or TEXT_PROMPT_TEMPLATES["default"])
        variants = PROMPT_NAME_VARIANTS.get(name, [name])
        prompts = []
        seen = set()
        for variant in variants:
            for template in templates:
                prompt = template.format(name=variant)
                if prompt not in seen:
                    seen.add(prompt)
                    prompts.append(prompt)
        return prompts

    def _extract_features(self, output):
        if hasattr(output, "pooler_output"):
            return output.pooler_output
        if hasattr(output, "last_hidden_state"):
            return output.last_hidden_state.mean(dim=1)
        return output

    def _encode_text_candidates(self, names, category="default"):
        if not self.enabled or not names:
            return None

        np = self._np
        torch = self._torch
        vectors = []

        for name in names:
            prompts = self._build_prompt_texts(name, category)
            inputs = self._processor(text=prompts, return_tensors="pt", padding=True).to(self.device)
            with torch.no_grad():
                output = self._model.get_text_features(**inputs)
                feats = self._extract_features(output)
                feats = feats / feats.norm(p=2, dim=-1, keepdim=True)
            vec = feats.mean(dim=0)
            vec = vec / vec.norm(p=2)
            vectors.append(vec.cpu().numpy().astype("float32"))

        return np.stack(vectors, axis=0)

    def _encode_prompt_groups(self, prompt_groups):
        if not self.enabled or not prompt_groups:
            return [], None

        np = self._np
        torch = self._torch
        labels = []
        vectors = []

        for label, prompts in prompt_groups.items():
            if not prompts:
                continue
            inputs = self._processor(text=list(prompts), return_tensors="pt", padding=True).to(self.device)
            with torch.no_grad():
                output = self._model.get_text_features(**inputs)
                feats = self._extract_features(output)
                feats = feats / feats.norm(p=2, dim=-1, keepdim=True)
            vec = feats.mean(dim=0)
            vec = vec / vec.norm(p=2)
            labels.append(label)
            vectors.append(vec.cpu().numpy().astype("float32"))

        if not vectors:
            return [], None

        return labels, np.stack(vectors, axis=0)

    def _rank_candidates(self, img_vec, names, features, threshold, top_k, category=None):
        if features is None or not names:
            return []

        np = self._np
        scores = np.matmul(features, img_vec)
        ranked = []
        for idx, score in enumerate(scores.tolist()):
            if float(score) < threshold:
                continue
            item = {
                "name": names[idx],
                "confidence": float(score),
                "source": "ai",
            }
            if category:
                item["category"] = category
            ranked.append(item)

        ranked.sort(key=lambda item: item["confidence"], reverse=True)
        return ranked[:top_k]

    def reload_tags(self):
        if not os.path.exists(self.db_path):
            grouped = self._merge_tag_groups([])
        else:
            conn = self._connect()
            try:
                cur = conn.cursor()
                cur.execute("SELECT category_id, name FROM tags ORDER BY usage_count DESC, name ASC")
                db_tag_rows = [(r[0], r[1]) for r in cur.fetchall()]
            finally:
                conn.close()
            grouped = self._merge_tag_groups(db_tag_rows)

        self._tag_category_names = grouped
        self._tag_names = []
        seen = set()
        for names in grouped.values():
            for name in names:
                if name not in seen:
                    seen.add(name)
                    self._tag_names.append(name)

        if not self.enabled or not self._tag_names:
            self._tag_features = None
            self._tag_category_features = {}
            self._weather_labels = []
            self._weather_features = None
            return {"tag_count": len(self._tag_names)}

        self._tag_features = self._encode_text_candidates(self._tag_names, "default")
        self._tag_category_features = {
            category: self._encode_text_candidates(names, category)
            for category, names in grouped.items()
            if names
        }
        self._weather_labels, self._weather_features = self._encode_prompt_groups(WEATHER_PROMPT_GROUPS)
        return {"tag_count": len(self._tag_names)}

    def embed_text(self, text):
        if not self.enabled:
            raise RuntimeError("python_engine_disabled")
        torch = self._torch
        inputs = self._processor(text=[text], return_tensors="pt", padding=True).to(self.device)
        with torch.no_grad():
            output = self._model.get_text_features(**inputs)
            feats = self._extract_features(output)
            feats = feats / feats.norm(p=2, dim=-1, keepdim=True)
        return feats[0].cpu().numpy().astype("float32")

    def embed_image(self, image_path):
        if not self.enabled:
            raise RuntimeError("python_engine_disabled")
        img = self._Image.open(image_path).convert("RGB")
        torch = self._torch
        inputs = self._processor(images=img, return_tensors="pt").to(self.device)
        with torch.no_grad():
            output = self._model.get_image_features(**inputs)
            feats = self._extract_features(output)
            feats = feats / feats.norm(p=2, dim=-1, keepdim=True)
        return feats[0].cpu().numpy().astype("float32")

    def predict_weather(self, img_vec, threshold=WEATHER_THRESHOLD, margin=WEATHER_MARGIN):
        if self._weather_features is None or not self._weather_labels:
            return {
                "label": None,
                "confidence": 0.0,
                "margin": 0.0,
                "source": "ai_weather",
            }

        np = self._np
        scores = np.matmul(self._weather_features, img_vec)
        if scores.size == 0:
            return {
                "label": None,
                "confidence": 0.0,
                "margin": 0.0,
                "source": "ai_weather",
            }

        ranked_indices = list(np.argsort(scores)[::-1])
        best_index = int(ranked_indices[0])
        best_score = float(scores[best_index])
        second_score = float(scores[int(ranked_indices[1])]) if len(ranked_indices) > 1 else -1.0
        score_margin = best_score - second_score
        label = self._weather_labels[best_index] if best_score >= threshold and score_margin >= margin else None

        return {
            "label": label,
            "confidence": best_score,
            "margin": score_margin,
            "source": "ai_weather",
            "candidates": [
                {
                    "name": self._weather_labels[int(idx)],
                    "confidence": float(scores[int(idx)]),
                }
                for idx in ranked_indices[:2]
            ],
        }

    def _detect_face_count(self, image_array):
        if self._face_detector is None:
            return None
        result = self._face_detector.process(image_array)
        detections = getattr(result, "detections", None) or []
        return len(detections)

    def _detect_body_count(self, image_array):
        if self._person_hog is None or self._cv2 is None:
            return None, None

        bgr_image = self._cv2.cvtColor(image_array, self._cv2.COLOR_RGB2BGR)
        rects, weights = self._person_hog.detectMultiScale(
            bgr_image,
            winStride=(8, 8),
            padding=(8, 8),
            scale=1.05,
        )
        if len(rects) == 0:
            return 0, 0.0

        valid_count = 0
        best_weight = 0.0
        for idx, _ in enumerate(rects):
            weight = float(weights[idx]) if len(weights) > idx else 0.0
            best_weight = max(best_weight, weight)
            if weight >= 0.55:
                valid_count += 1
        return valid_count, best_weight

    def detect_people_presence(self, image_path):
        image = self._Image.open(image_path).convert("RGB")
        image_array = self._np.array(image)

        face_count = self._detect_face_count(image_array)
        body_count, body_best_weight = self._detect_body_count(image_array)
        label = None
        source = "people_detector_unavailable"

        if face_count is not None:
            source = "mediapipe_face"
            if face_count == 1:
                label = "\u5355\u4eba"
            elif face_count >= 2:
                label = "\u591a\u4eba"

        if label is None and body_count is not None:
            source = "opencv_body" if face_count in (None, 0) else source
            if body_count == 1:
                label = "\u5355\u4eba"
            elif body_count >= 2:
                label = "\u591a\u4eba"

        return {
            "face_count": face_count,
            "body_count": body_count,
            "body_best_weight": body_best_weight,
            "label": label,
            "source": source,
        }

    def predict_tags(self, image_path, threshold=0.07, max_tags=18):
        if not self.enabled or (self._tag_features is None and not self._tag_category_features):
            return {"tags": []}

        img_vec = self.embed_image(image_path)
        ranked = []
        ranked.extend(self._rank_candidates(
            img_vec,
            self._tag_names,
            self._tag_features,
            threshold=threshold,
            top_k=max_tags,
        ))

        for category, names in self._tag_category_names.items():
            if category not in CATEGORY_RESULT_LIMITS:
                continue
            ranked.extend(self._rank_candidates(
                img_vec,
                names,
                self._tag_category_features.get(category),
                threshold=CATEGORY_RESULT_THRESHOLDS.get(category, threshold),
                top_k=CATEGORY_RESULT_LIMITS.get(category, 1),
                category=category,
            ))

        ranked.sort(key=lambda item: item["confidence"], reverse=True)
        deduped = []
        seen = set()
        for item in ranked:
            name = item["name"]
            if name in seen:
                continue
            seen.add(name)
            deduped.append(item)
            if len(deduped) >= max_tags:
                break

        return {
            "tags": deduped,
            "vector": img_vec.tolist(),
            "weather": self.predict_weather(img_vec),
            "people_analysis": self.detect_people_presence(image_path),
        }

    def add_vector(self, image_id, vector):
        if not self.enabled:
            raise RuntimeError("python_engine_disabled")
        np = self._np
        vec = np.array(vector, dtype="float32")
        if vec.shape[0] != self.vector_dim:
            raise RuntimeError("invalid_vector_dim")
        self._index.add(np.expand_dims(vec, 0))
        self._index_image_ids.append(int(image_id))
        return {"count": len(self._index_image_ids)}

    def search_text(self, query, top_k=50):
        if not self.enabled:
            raise RuntimeError("python_engine_disabled")
        np = self._np
        q = self.embed_text(query)
        distances, indices = self._index.search(np.expand_dims(q, 0), int(top_k))
        results = []
        for i, idx in enumerate(indices[0]):
            if idx < 0:
                continue
            results.append({
                "image_id": self._index_image_ids[int(idx)],
                "score": float(distances[0][i])
            })
        return {"results": results}

    def batch_predict_tags(self, image_paths, threshold=0.07, max_tags=18):
        if not self.enabled or (self._tag_features is None and not self._tag_category_features):
            print("[batch_predict_tags] engine not ready")
            return {"results": []}

        results = []
        print(f"[batch_predict_tags] processing {len(image_paths)} images")
        for idx, image_path in enumerate(image_paths):
            try:
                if not image_path or not str(image_path).strip():
                    print(f"[batch_predict_tags] #{idx}: empty path, skipping")
                    results.append({"path": image_path or "", "tags": [], "vector": None})
                    continue
                print(f"[batch_predict_tags] #{idx}: {image_path}")
                prediction = self.predict_tags(image_path, threshold=threshold, max_tags=max_tags)
                print(f"[batch_predict_tags] #{idx}: tags={prediction.get('tags', [])}")
                results.append({
                    "path": image_path,
                    "tags": prediction.get("tags", []),
                    "vector": prediction.get("vector"),
                    "weather": prediction.get("weather"),
                    "people_analysis": prediction.get("people_analysis"),
                })
            except Exception as error:
                print(f"[batch_predict_tags] #{idx}: error {error}")
                results.append({"path": image_path, "tags": [], "vector": None, "weather": None, "people_analysis": None})

        print(f"[batch_predict_tags] done, {len(results)} results")
        return {"results": results}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", required=True)
    parser.add_argument("--model", default="OFA-Sys/chinese-clip-vit-base-patch16")
    args = parser.parse_args()

    engine = Engine(db_path=args.db, model_name=args.model)
    _write({"type": "ready", "enabled": engine.enabled, "timestamp": int(time.time())})

    while True:
        msg = _read()
        if msg is None:
            return

        req_id = msg.get("id")
        cmd = msg.get("cmd")
        data = msg.get("data") or {}
        ts = int(time.time())

        try:
            if cmd == "health":
                out = {"ok": True, "enabled": engine.enabled, "model": engine.model_name}
            elif cmd == "reload_tags":
                out = engine.reload_tags()
            elif cmd == "embed_text":
                out = {"vector": engine.embed_text(data.get("text", "")).tolist()}
            elif cmd == "embed_image":
                out = {"vector": engine.embed_image(data.get("path", "")).tolist()}
            elif cmd == "predict_tags":
                out = engine.predict_tags(
                    data.get("path", ""),
                    threshold=float(data.get("threshold", 0.07)),
                    max_tags=int(data.get("max_tags", 18)),
                )
            elif cmd == "add_vector":
                out = engine.add_vector(data.get("image_id"), data.get("vector"))
            elif cmd == "search_text":
                out = engine.search_text(data.get("query", ""), top_k=int(data.get("top_k", 50)))
            elif cmd == "batch_predict_tags":
                out = engine.batch_predict_tags(
                    data.get("paths", []),
                    threshold=float(data.get("threshold", 0.07)),
                    max_tags=int(data.get("max_tags", 18)),
                )
            else:
                raise RuntimeError("unknown_command")

            _write({"id": req_id, "ok": True, "data": out, "timestamp": ts})
        except Exception as error:
            _write({"id": req_id, "ok": False, "error": str(error), "timestamp": ts})


if __name__ == "__main__":
    main()
