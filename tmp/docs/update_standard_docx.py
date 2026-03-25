from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH


ROOT = Path(__file__).resolve().parents[2]
WORK_DOCX = ROOT / "standard_work.docx"
TARGET_DOCX = ROOT / "煤科小论文" / "煤炭科学技术_投稿稿_标准格式.docx"


PARAGRAPHS = [
    ("面向采区智能设计的稀疏钻孔煤系地层三维建模方法与验证", True),
    ("作者：刘浩天", False),
    ("单位：中国矿业大学（北京）", False),
    ("中图分类号：[待补]  文献标志码：A  文章编号：[待刊发后编排]", False),
    ("DOI：[待刊发后编排]", False),
    ("收稿日期：[待补]  责任编辑：[期刊填写]", False),
    ("基金项目：[待补]", False),
    ("作者简介：刘浩天，中国矿业大学（北京）。E-mail: gqt2500103011@student.cumtb.edu.cn", False),
    ("通信作者 E-mail：gqt2500103011@student.cumtb.edu.cn", False),
    ("Three-dimensional modeling and validation of coal-measure strata under sparse borehole constraints for panel design", False),
    ("Liu Haotian", False),
    ("China University of Mining and Technology-Beijing, Beijing 100083, China", False),
    ("摘 要", False),
    (
        "针对采区智能设计对透明地质模型的需求以及稀疏钻孔条件下煤系地层建模中存在的缺层与薄层混淆、不同层位见层样本不均衡、独立逐层插值易造成层间结构失真等问题，提出了一种面向采区设计基础支撑的层存在性与正厚度解耦三维建模方法。该方法首先依据钻孔层位信息构建层存在概率场，在此基础上仅利用见层样本进行正厚度插值；随后根据见层样本规模实施自适应插值策略，并通过累计层面重建、非负厚度约束和单调性校正构建满足层序关系的三维块体模型。基于28个钻孔数据，采用留一钻孔验证和空间分块验证2类协议，从层存在性F1、厚度MAE/RMSE及层序一致性等方面对模型进行评估。结果表明：所建模型在2类验证协议下的层序一致性有效率均为1.000；煤层层位在留一钻孔和空间分块验证下的平均F1分别为0.224和0.324，平均MAE分别为0.632 m和1.667 m；岩性层位对应平均F1分别为0.253和0.315，平均MAE分别为3.617 m和7.599 m。研究表明，所提方法能够在稀疏钻孔条件下稳定构建满足层序约束的煤系地层三维模型，并揭示不同层位在点位泛化和空间外推条件下的性能差异，可为煤矿透明地质建模、工作面布置和采区智能设计提供基础模型支撑。",
        False,
    ),
    ("关键词：煤系地层；稀疏钻孔；三维地质建模；层存在性；厚度插值；层序一致性；采区智能设计", False),
    ("Abstract", False),
    (
        "To address the demand for transparent geological models in panel design and the problems of confusion between missing layers and thin layers, highly imbalanced observed samples among stratigraphic units, and structural distortion caused by independent layer-by-layer interpolation under sparse borehole conditions, a decoupled three-dimensional modeling method of layer existence and positive thickness was proposed. The method first constructs a probability field for layer occurrence from borehole stratigraphic records and then performs positive-thickness interpolation using only observed samples. An adaptive interpolation strategy is further adopted according to the number of observed samples, and a three-dimensional block model satisfying stratigraphic order is reconstructed through cumulative surface generation, non-negative thickness constraints, and monotonicity correction. Based on 28 boreholes, leave-one-borehole validation and spatial-block validation were carried out, and the model was evaluated using layer-existence F1, thickness MAE/RMSE, and stratigraphic consistency metrics. The results show that the valid ratio of stratigraphic consistency reached 1.000 in both protocols. The proposed method can be used to construct three-dimensional coal-measure stratigraphic models with stratigraphic-order constraints under sparse borehole conditions and to provide a geological basis for transparent geology, panel layout, and intelligent mining-area design.",
        False,
    ),
    ("Key words：coal-measure strata; sparse boreholes; three-dimensional geological modeling; layer existence; thickness interpolation; stratigraphic consistency; panel design", False),
    ("0 引 言", False),
    (
        "煤系地层三维建模是煤矿透明地质、工作面布置、巷道设计和地质保障决策的重要基础。当前煤矿地质模型构建仍高度依赖钻孔资料，而多数矿区钻孔在空间上呈稀疏离散分布，钻孔间见层组合、厚度变化和层位连续性存在明显差异。在此条件下，如何利用有限钻孔资料恢复煤系地层的空间展布、厚度变化与层间结构关系，已经成为煤矿数字地质模型构建中的关键问题。",
        False,
    ),
    (
        "现有工程实践中，常见做法是直接对各层厚度进行空间插值后逐层叠置生成三维结构。但这一做法存在2个基础性问题：一是未见层常被直接记为零厚度样本参与插值，容易将局部缺失、尖灭边界和真实薄层混为一体；二是不同层位独立插值后缺乏全局层序约束，容易在三维空间中出现顶底板交叉、局部倒置和负厚度等现象。上述问题不仅影响模型的地学可解释性，也会削弱模型在工作面布置和采区工程决策中的应用价值。",
        False,
    ),
    (
        "针对上述问题，本文提出一种面向采区智能设计基础支撑的层存在性与正厚度解耦煤系地层三维建模方法。该方法首先预测层位在空间上的存在概率，再仅使用见层样本对正厚度进行插值估计，随后依据层位样本规模实施自适应插值策略，最后通过累计层面重建和层序一致性校正生成满足地层顺序约束的三维块体模型。与单纯追求更复杂插值器不同，本文重点在于重构建模任务表达形式，并将层序一致性引入模型构建主流程之中。",
        False,
    ),
    (
        "基于28个钻孔数据，本文设计留一钻孔验证和空间分块验证2类协议，对煤层层位和岩性层位分别进行评估。研究目标包括：1）构建满足层序关系的煤系地层三维模型；2）评估层存在性与厚度恢复在不同验证协议下的表现；3）分析煤层与岩性层位在点位泛化和空间外推条件下的差异；4）说明该模型在采区智能设计中的基础支撑意义。",
        False,
    ),
    ("1 数据基础与研究方法", False),
    ("1.1 钻孔数据基础", False),
    (
        "研究数据来自项目目录中的28个钻孔柱状资料及其平面坐标信息。每个钻孔记录了层位名称和厚度数据，层位类型同时包含煤层和多种岩性单元。钻孔坐标用于建立统一平面网格，并为后续层位空间建模、块体构建和下游设计调用提供几何基础。",
        False,
    ),
    ("1.2 总体技术路线", False),
    (
        "本文总体技术路线如图1所示。首先完成钻孔层位解析、见层统计和层序候选集构建；随后分别建立层存在概率场和正厚度插值场；再通过存在掩码将2类结果融合为逐层厚度结果；最后在层序一致性约束下重建累计层面和三维块体模型，并输出验证表格、示意图和对比图。生成的三维地质结果进一步可为工作面布置和采区智能设计提供结构化地质输入。",
        False,
    ),
    ("1.3 层存在性与正厚度解耦建模", False),
    (
        "本文将单层位建模拆解为“层是否存在”和“存在时厚度是多少”2个子问题，如图2所示。对任意层位l和空间位置s，首先估计层存在概率：",
        False,
    ),
    ("P_l(s)=Σ[w_i(s)e_(i,l)] / Σ[w_i(s)]。", False),
    (
        "其中，e_(i,l)为第i个钻孔对层位l的见层指示变量。随后仅在见层样本集合上进行正厚度插值：",
        False,
    ),
    ("T_l(s)=Σ[w_i(s)t_(i,l)] / Σ[w_i(s)]，i∈Ω_l。", False),
    (
        "其中，Ω_l为见层样本集合，t_(i,l)为对应观测厚度。最终厚度结果由存在概率阈值和最小正厚度阈值共同控制：当P_l(s)≥τ时，取max(T_l(s), h_min)；当P_l(s)<τ时，厚度记为0。该过程避免将未见层直接作为零厚度样本引入插值，有利于保留尖灭边界和缺层区域的空间特征。",
        False,
    ),
    ("1.4 自适应插值策略", False),
    (
        "考虑到不同层位见层样本数差异较大，本文采用自适应插值策略，如图4所示。当见层样本数小于3时，采用常数法进行保守估计；当见层样本数位于3~9之间时，采用IDW插值；当见层样本数不少于10时，采用高阶插值方案。无论使用何种插值器，均进行统一后处理，包括NaN填补、最小正厚度裁剪和存在掩码回写。",
        False,
    ),
    ("1.5 层序一致性约束与块体构建", False),
    (
        "独立逐层插值无法保证不同层位在三维空间中的相对位置正确，因此本文引入累计层面和一致性校正机制，如图3所示。设层序为{1,2,…,K}，从基准高程出发按层序逐层累积厚度，构建顶底板。对任意相邻层位，要求满足相邻层顶底板单调关系，同时要求任意层位厚度非负。若局部位置出现重叠、负厚度或非单调关系，则执行校正，将异常恢复到满足地层顺序的状态。校正后得到的层面集合进一步生成三维块体模型和剖面结果。",
        False,
    ),
    ("1.6 验证协议与评估指标", False),
    (
        "本文采用2类验证协议，见图5。第一类为留一钻孔验证，即每轮剔除1个钻孔作为测试对象，用于检验点位恢复能力；第二类为空间分块验证，即按平面位置将28个钻孔划分为4个空间子集，每轮留出1个空间块作为测试集，用于检验模型的空间外推能力。",
        False,
    ),
    (
        "评估指标体系见图6，主要包括：1）层存在性指标，包括Precision、Recall和F1；2）厚度误差指标，包括MAE和RMSE，且仅在真实见层样本上统计；3）层序一致性指标，包括有效率、重叠单元计数、负厚度单元计数和非单调单元计数。考虑到当前样本量为28个钻孔，本文定位为工程验证与方法比较，因此统计报告以样本量、绝对差值和相对提升描述效应量，不报告p值。",
        False,
    ),
    ("2 结果与分析", False),
    ("2.1 层序一致性结果", False),
    (
        "在28折留一钻孔验证和4折空间分块验证中，本文模型的层序一致性有效率均为1.000，重叠单元、负厚度单元和非单调单元计数均为0。该结果表明，本文提出的累计层面与一致性校正流程能够稳定地将逐层预测结果转化为满足地层顺序的三维结构，避免出现几何不可解释问题。这一性质也是模型能够进一步服务采区设计计算的前提。",
        False,
    ),
    ("2.2 煤层层位结果分析", False),
    (
        "煤层层位结果见表2。30个煤层相关层位在留一钻孔验证下的平均F1为0.224，空间分块验证下的平均F1为0.324；对应平均MAE分别为0.632 m和1.667 m。结果表明，煤层在点位条件下的判别能力与区域外推条件下的厚度恢复能力并不完全一致。",
        False,
    ),
    (
        "从效应量角度看，空间分块验证下煤层平均F1较留一钻孔提高0.100，相对提升约44.6%；但平均MAE增加1.035 m，相对增加约163.8%。这说明更高的区域级存在性判别能力并未同步转化为更低的厚度恢复误差。",
        False,
    ),
    (
        "在空间分块验证中，16-3煤、煤、16-3上煤、15-4煤和15-7煤的存在性F1相对较高，说明这些层位在空间上的出现模式较为稳定。但高F1并不意味着厚度误差一定较低，表明“层是否存在”和“存在时有多厚”应当分开评估。",
        False,
    ),
    (
        "16-4煤和16-2上煤在空间分块验证下的F1下降较明显，说明部分煤层对局部样本支撑更为敏感，空间外推时的不确定性更高。",
        False,
    ),
    ("2.3 岩性层位结果分析", False),
    (
        "岩性层位结果见表3。24个岩性层位在留一钻孔验证下的平均F1为0.253，空间分块验证下的平均F1为0.315；对应平均MAE分别为3.617 m和7.599 m。与煤层相比，岩性层位的厚度误差整体更大，说明其厚度变化和边界关系更复杂。",
        False,
    ),
    (
        "从效应量角度看，空间分块验证下岩性层位平均F1较留一钻孔提高0.062，相对提升约24.5%；但平均MAE增加3.982 m，相对增加约110.1%。这表明岩性层位在空间外推条件下面临更强的厚度恢复压力。",
        False,
    ),
    (
        "粉砂岩、泥岩、细砂岩、炭质泥岩和中砾岩在空间分块验证下表现出较高的存在性F1，但其中部分层位的厚度MAE依然较大，表明岩性层位在“存在性判别”和“厚度恢复”之间同样存在明显难度差异。细砂岩、砾岩、砂砾岩、中砂岩和黏土等层位在空间分块验证中的厚度误差较大，提示这些岩性单元的厚度变化可能更受局部地质条件控制。",
        False,
    ),
    ("2.4 实际建模效果与方法对比", False),
    (
        "图9给出了基于真实钻孔数据生成的代表性层位建模结果，包括厚度场、三维层面形态和剖面结构。从图9可以看出，模型不仅恢复了平面厚度分布，还保持了剖面中的层序关系，这与层序一致性统计结果一致。对于后续工作面布置而言，这意味着模型输出不仅具备平面解释意义，而且具备可用于工程空间约束的结构表达能力。",
        False,
    ),
    (
        "图10对比了传统单阶段插值方案与本文解耦建模方案在代表性煤层上的空间结果。传统方案将缺层位置直接视为零厚度并参与插值，因此更容易在缺层边界附近形成平滑扩散；本文方法通过存在性预测与正厚度插值解耦，在缺层区域形成更清晰的掩码边界。该结果说明，本文方法能够更明确地区分“无层区域”和“有层但较薄的区域”。",
        False,
    ),
    ("3 讨 论", False),
    (
        "从煤矿工程应用角度看，本文方法的价值主要体现在2个方面。其一，模型输出不再只是局部厚度估计，而是能够形成满足地层顺序约束的三维结构结果，更适合用于煤矿透明地质模型构建。其二，本文将存在性与厚度恢复分开评估，使建模结果的误差来源更加清晰，有利于后续针对不同层位类型开展定向优化，并为工作面布置和采区方案比选提供更稳定的地质基础。",
        False,
    ),
    (
        "但也应看到，当前结果仍存在明显边界。虽然结构一致性已经稳定达到较高水平，但空间分块验证下的厚度误差仍然较大，尤其是部分岩性层位，说明模型在区域外推条件下仍受样本分布和地质异质性限制。此外，当前存在性预测仍以距离加权传播为主，属于稳健基线方法，未来可结合更多地质先验、辅助变量或图结构学习策略进一步提高层边界判别能力。",
        False,
    ),
    (
        "因此，本文现阶段更适合支撑以下判断：在稀疏钻孔条件下，所提方法能够稳定构建满足层序约束的煤系地层三维模型，并能够揭示不同层位在点位泛化与空间外推条件下的行为差异；该模型可以作为采区智能设计和工程布局优化的基础地质输入。但若要进一步面向更高精度工程应用，还需在多区域重复验证、边界判别、不确定性表达和下游耦合评价方面继续深化。",
        False,
    ),
    ("4 结 论", False),
    (
        "1. 针对稀疏钻孔条件下煤系地层三维建模中存在的层缺失与薄层混淆、样本规模差异过大以及独立逐层插值导致结构失真等问题，提出了一种面向采区智能设计基础支撑的层存在性与正厚度解耦建模方法。",
        False,
    ),
    (
        "2. 通过引入自适应插值策略、累计层面重建和层序一致性校正，所建模型在留一钻孔验证和空间分块验证下均保持1.000的层序一致性有效率，说明该方法能够稳定输出满足地层顺序关系的三维结构结果。",
        False,
    ),
    (
        "3. 煤层和岩性层位在层存在性F1和厚度误差方面表现出明显差异，说明层位存在性判别与厚度恢复应当分开评价，不同层位的空间外推难度存在显著异质性。",
        False,
    ),
    (
        "4. 所提方法能够为煤矿透明地质、数字地质模型构建以及工作面布置和采区智能设计提供基础模型支撑，但在多区域推广应用前仍需进一步补强参考文献支撑、跨区域验证和不确定性分析。",
        False,
    ),
    ("参考文献", False),
    ("[待补并逐条核验。当前未写入正式参考文献条目，以避免伪造引用。]", False),
]


def clear_document(doc: Document) -> None:
    body = doc._body._element
    for child in list(body):
        if child.tag.endswith("sectPr"):
            continue
        body.remove(child)


def main() -> None:
    doc = Document(str(WORK_DOCX))
    clear_document(doc)

    for text, centered in PARAGRAPHS:
        p = doc.add_paragraph(text, style="Normal")
        if centered:
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER

    doc.save(str(WORK_DOCX))
    TARGET_DOCX.write_bytes(WORK_DOCX.read_bytes())


if __name__ == "__main__":
    main()
